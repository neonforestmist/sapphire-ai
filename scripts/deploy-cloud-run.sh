#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-plan}"

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-sapphireai}"
AR_REPOSITORY="${AR_REPOSITORY:-sapphireai}"
IMAGE_NAME="${IMAGE_NAME:-web}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-sapphireai-runtime}"
FIRESTORE_DATABASE_ID="${FIRESTORE_DATABASE_ID:-(default)}"
GCS_BUCKET="${GCS_BUCKET:-}"
GEMINI_SECRET_NAME="${GEMINI_SECRET_NAME:-sapphireai-gemini-api-key}"
SESSION_SECRET_NAME="${SESSION_SECRET_NAME:-sapphireai-session-signing-secret}"
MAX_INSTANCES="${MAX_INSTANCES:-1}"
GEMINI_REASONING_MODEL="${GEMINI_REASONING_MODEL:-gemini-3.5-flash}"
GEMINI_LIVE_MODEL="${GEMINI_LIVE_MODEL:-gemini-3.1-flash-live-preview}"
ENABLE_GEMINI_LIVE="${ENABLE_GEMINI_LIVE:-false}"

readonly REQUIRED_APIS=(
  run.googleapis.com
  artifactregistry.googleapis.com
  cloudbuild.googleapis.com
  firestore.googleapis.com
  storage.googleapis.com
  secretmanager.googleapis.com
)

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

display_value() {
  local value="$1"
  local fallback="$2"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '<%s>' "$fallback"
  fi
}

print_plan() {
  note "SapphireAI Cloud Run deployment plan (no commands executed)"
  note ""
  note "Project:                $(display_value "$PROJECT_ID" required-project-id)"
  note "Region:                 $REGION"
  note "Service:                $SERVICE_NAME"
  note "Artifact repository:    $AR_REPOSITORY"
  note "Image:                  $IMAGE_NAME"
  note "Runtime service account:$RUNTIME_SERVICE_ACCOUNT"
  note "Firestore database:     $FIRESTORE_DATABASE_ID"
  note "Snapshot bucket:        $(display_value "$GCS_BUCKET" required-private-bucket)"
  note "Gemini secret:          $GEMINI_SECRET_NAME"
  note "Session secret:         $SESSION_SECRET_NAME"
  note "Maximum instances:      $MAX_INSTANCES"
  note ""
  note "This script will never enable APIs, create resources, grant IAM, add secret"
  note "values, or delete resources. Prepare those separately after explicit approval"
  note "using docs/GOOGLE_CLOUD.md."
  note ""
  note "preflight: read-only validation of auth, APIs, and existing resources"
  note "deploy:   Cloud Build submission and Cloud Run mutation after a project-specific"
  note "          CONFIRM_DEPLOY value; private unless separately confirmed public"
  note ""
  note "Required deploy confirmation:"
  note "  CONFIRM_DEPLOY=deploy-sapphireai-$(display_value "$PROJECT_ID" PROJECT_ID)"
  note ""
  note "Public exposure additionally requires:"
  note "  PUBLIC_DEPLOY=1"
  note "  CONFIRM_PUBLIC=publish-sapphireai-$(display_value "$PROJECT_ID" PROJECT_ID)"
}

require_configuration() {
  [[ -n "$PROJECT_ID" ]] || die "PROJECT_ID is required."
  [[ -n "$GCS_BUCKET" ]] || die "GCS_BUCKET is required."
  [[ "$MAX_INSTANCES" =~ ^[1-9][0-9]*$ ]] || die "MAX_INSTANCES must be a positive integer."
  [[ -f package.json ]] || die "package.json is missing."
  [[ -f pnpm-lock.yaml ]] || die "pnpm-lock.yaml is missing."
  [[ -f Dockerfile ]] || die "Dockerfile is missing."
}

require_gcloud() {
  command -v gcloud >/dev/null 2>&1 || die "gcloud is not installed. See docs/GOOGLE_CLOUD.md."
  local account
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)"
  [[ -n "$account" ]] || die "No active gcloud account. Authenticate through an approved flow."
}

preflight() {
  require_configuration
  require_gcloud

  note "Running read-only preflight for project $PROJECT_ID..."
  gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null

  local billing_enabled
  billing_enabled="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')"
  [[ "$billing_enabled" == "True" ]] || die "Project billing is not enabled. Link only an approved Free Trial account; never activate paid billing from this script."

  local enabled_apis
  enabled_apis="$(gcloud services list --enabled --project="$PROJECT_ID" --format='value(config.name)')"

  local api
  local missing_api=0
  for api in "${REQUIRED_APIS[@]}"; do
    if ! grep -Fqx "$api" <<<"$enabled_apis"; then
      printf 'Missing enabled API: %s\n' "$api" >&2
      missing_api=1
    fi
  done
  [[ "$missing_api" -eq 0 ]] || die "Required APIs are missing. This script will not enable them."

  gcloud artifacts repositories describe "$AR_REPOSITORY" --location="$REGION" --project="$PROJECT_ID" --format='value(name)' >/dev/null
  gcloud firestore databases describe --database="$FIRESTORE_DATABASE_ID" --project="$PROJECT_ID" --format='value(name)' >/dev/null
  gcloud storage buckets describe "gs://$GCS_BUCKET" --format='value(name)' >/dev/null
  gcloud iam service-accounts describe "$RUNTIME_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID" --format='value(email)' >/dev/null
  gcloud secrets describe "$GEMINI_SECRET_NAME" --project="$PROJECT_ID" --format='value(name)' >/dev/null
  gcloud secrets describe "$SESSION_SECRET_NAME" --project="$PROJECT_ID" --format='value(name)' >/dev/null

  local gemini_version
  local session_version
  gemini_version="$(gcloud secrets versions list "$GEMINI_SECRET_NAME" --project="$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)')"
  session_version="$(gcloud secrets versions list "$SESSION_SECRET_NAME" --project="$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)')"
  [[ -n "$gemini_version" ]] || die "No enabled version exists for $GEMINI_SECRET_NAME."
  [[ -n "$session_version" ]] || die "No enabled version exists for $SESSION_SECRET_NAME."

  note "Preflight passed. The operator must still verify that billing remains Free Trial, runtime IAM is narrow, and public invocation is disabled."
}

deploy() {
  preflight

  local expected_confirmation="deploy-sapphireai-$PROJECT_ID"
  [[ "${CONFIRM_DEPLOY:-}" == "$expected_confirmation" ]] || die "Refusing deployment. Set CONFIRM_DEPLOY=$expected_confirmation after explicit approval."

  local access_flag="--no-allow-unauthenticated"
  if [[ "${PUBLIC_DEPLOY:-0}" == "1" ]]; then
    local expected_public="publish-sapphireai-$PROJECT_ID"
    [[ "${CONFIRM_PUBLIC:-}" == "$expected_public" ]] || die "Refusing public exposure. Set CONFIRM_PUBLIC=$expected_public after explicit approval."
    access_flag="--allow-unauthenticated"
  fi

  local tag
  tag="${IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"
  local image_uri="$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPOSITORY/$IMAGE_NAME:$tag"
  local runtime_email="$RUNTIME_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
  local gemini_version
  local session_version
  gemini_version="$(gcloud secrets versions list "$GEMINI_SECRET_NAME" --project="$PROJECT_ID" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)')"
  session_version="$(gcloud secrets versions list "$SESSION_SECRET_NAME" --project="$PROJECT_ID" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)')"
  [[ -n "$gemini_version" && -n "$session_version" ]] || die "Both secrets need an enabled numeric version before deployment."

  note "Submitting chargeable Cloud Build for $image_uri..."
  gcloud builds submit . --tag="$image_uri" --project="$PROJECT_ID" --region="$REGION" --machine-type=e2-standard-2 --timeout=20m

  note "Deploying Cloud Run service $SERVICE_NAME..."
  gcloud run deploy "$SERVICE_NAME" --image="$image_uri" --region="$REGION" --project="$PROJECT_ID" --platform=managed --service-account="$runtime_email" --port=8080 --cpu=1 --memory=1Gi --cpu-throttling --concurrency=40 --timeout=300 --min=0 --min-instances=0 --max="$MAX_INSTANCES" --max-instances="$MAX_INSTANCES" --ingress=all "$access_flag" --set-env-vars="GEMINI_REASONING_MODEL=$GEMINI_REASONING_MODEL,GEMINI_LIVE_MODEL=$GEMINI_LIVE_MODEL,GEMINI_MODE=real,ENABLE_GEMINI_LIVE=$ENABLE_GEMINI_LIVE,ENABLE_FIRESTORE=true,ENABLE_CLOUD_STORAGE=true,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_REGION=$REGION,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID,GCS_BUCKET=$GCS_BUCKET" --set-secrets="GEMINI_API_KEY=$GEMINI_SECRET_NAME:$gemini_version,SESSION_SIGNING_SECRET=$SESSION_SECRET_NAME:$session_version"

  local service_url
  service_url="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')"
  [[ -n "$service_url" ]] || die "Deployment returned no service URL."

  note "Setting APP_BASE_URL to the verified Cloud Run service URL..."
  gcloud run services update "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --update-env-vars="APP_BASE_URL=$service_url" >/dev/null

  note "Checking $service_url/api/health..."
  if [[ "${PUBLIC_DEPLOY:-0}" == "1" ]]; then
    curl --fail --silent --show-error "$service_url/api/health" >/dev/null
  else
    local identity_token
    # Human gcloud identities cannot set a custom audience. Cloud Run accepts
    # the default user identity token for an authorized private invocation.
    identity_token="$(gcloud auth print-identity-token)"
    curl --fail --silent --show-error --header "Authorization: Bearer $identity_token" "$service_url/api/health" >/dev/null
    unset identity_token
  fi

  note "Health check passed for $service_url."
  note "This does not verify the flagship journey. Complete clean-browser QA and update docs/QA_REPORT.md."
}

case "$MODE" in
  plan)
    print_plan
    ;;
  preflight)
    preflight
    ;;
  deploy)
    deploy
    ;;
  *)
    die "Usage: bash scripts/deploy-cloud-run.sh [plan|preflight|deploy]"
    ;;
esac
