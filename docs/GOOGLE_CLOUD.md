# Google Cloud deployment runbook

Last updated: 2026-07-13

## Current verified status

The approved Google Cloud foundation is deployed in `us-central1`. It remains private and bounded for the Google Cloud Free Trial. Exact project and resource identifiers are intentionally omitted from this public runbook. This inventory is based on read-only CLI inspection; the billing-account type was separately verified in Cloud Console because `billingEnabled: true` alone cannot distinguish a Free Trial from a paid account.

| Resource | Verified state |
| --- | --- |
| Google Cloud CLI | Authenticated `gcloud` 575.0.1 |
| Application project | Private project linked to the Console-labeled `Free trial account` |
| Cloud Run | Private service `sapphireai`; zero minimum instances, maximum one instance, CPU throttling, 1 vCPU / 1 GiB, Gemini mode `real`, Live disabled |
| Cloud Run access | No `allUsers` or `allAuthenticatedUsers` IAM binding; unauthenticated health requests return `403`, while an authorized health request returns `200` |
| Firestore | Native `(default)` database in `us-central1`; `freeTier: true`, delete protection enabled, point-in-time recovery disabled |
| Cloud Storage | Private snapshot bucket in `US-CENTRAL1`; uniform access and public-access prevention enforced; soft-delete retention disabled |
| Artifact Registry | Docker repository `sapphireai` in `us-central1`; active cleanup deletes images older than seven days while retaining the three most recent |
| Runtime identity | Dedicated runtime service account; Firestore user at project scope, object user on the selected bucket, and accessor on each named secret |
| Secret Manager | `sapphireai-gemini-api-key` and `sapphireai-session-signing-secret`; the Cloud Run template pins numeric versions rather than `latest` |
| Gemini authorization project | Separate private project; billing is disabled and requests are subject to Gemini Developer API Free Tier quota |

The canonical Cloud Run URL is intentionally withheld because it is not a public demo URL. Invocation requires Google Cloud authorization until public exposure receives separate approval.

The cloud resources, container build, private deployment configuration, and authorized health probe are verified. That does not by itself prove application-level Firestore/Storage writes or the full flagship journey against real Gemini; those integration, provider-smoke, and browser results belong in `docs/QA_REPORT.md`. Local memory-backed mock mode remains available without cloud credentials.

## Target architecture

~~~mermaid
flowchart TB
    Browser["Browser"]
    Run["Cloud Run<br/>Next.js container"]
    Firestore["Firestore<br/>sessions + ordered evidence"]
    Storage["Cloud Storage<br/>private selected snapshots"]
    Secrets["Secret Manager<br/>Gemini + session signing"]
    Logs["Cloud Logging<br/>structured stdout/stderr"]
    Gemini["Gemini API"]
    Build["Cloud Build + Artifact Registry"]

    Browser <-->|"HTTPS"| Run
    Run --> Firestore
    Run --> Storage
    Secrets -->|"revision-time secret refs"| Run
    Run --> Logs
    Run --> Gemini
    Build -->|"immutable image"| Run
~~~

Service responsibilities:

- **Cloud Run:** complete Next.js application, owned APIs, health endpoint, server Gemini gateway, and repository adapters.
- **Firestore:** structured sessions, finalized transcripts, normalized scenes, append-only events, validated reasoning, reports, and cloud rate-limit state.
- **Cloud Storage:** selected bounded board PNGs only. The bucket is private, uses uniform bucket-level access, and has public-access prevention.
- **Secret Manager:** permanent Gemini authorization and the anonymous-session signing secret.
- **Cloud Logging:** metadata-only JSON logs emitted to stdout/stderr.
- **Artifact Registry / Cloud Build:** reproducible image storage/build where local Docker is unavailable.

The runtime makes no persistent writes to the container filesystem.

## Approval gates

The provisioning and private deployment above were explicitly authorized. Stop and obtain new approval before any material expansion, including:

1. selecting `Activate`, upgrading billing, adding Gemini prepay funds, or enabling automatic reload;
2. changing the approved project, region, Firestore location, or storage location;
3. increasing Cloud Run minimum/maximum instances, CPU, memory, or concurrency;
4. enabling Gemini Live or another paid/Preview service path;
5. granting or broadening IAM;
6. adding or rotating secret values outside an approved secure flow;
7. running another build/deployment that consumes trial credit or service quota;
8. allowing unauthenticated invocation; or
9. deleting remote data/resources.

The repository’s deployment script does not create the base APIs, database, bucket, repository, identities, or secrets. Its `plan` mode is non-mutating, `preflight` performs read-only checks, and `deploy` requires a project-specific confirmation string and refuses to continue unless the approved resources already exist.

## Free Trial and no-card-spend boundary

The application project is linked to the explicitly approved, non-billable Google Cloud Free Trial account. Linking that account makes the project report `billingEnabled: true`, which is required by several APIs, but does not itself upgrade the account to paid billing. At provisioning time, Cloud Console showed the Free Trial credit and remaining trial period; the Console remains authoritative for the current balance and expiry.

Operating rules:

- Confirm the Cloud Console still labels the billing account `Free trial account` before and after deployment.
- Never select `Activate`, upgrade to a Paid billing account, add prepay funds, or enable automatic payment/reload as part of this runbook.
- A non-billable Free Trial provides $300 of eligible Google Cloud credit for 90 days. If the credit or trial expires without an upgrade, Google stops the trial resources rather than charging the payment method.
- The Google Cloud trial credit cannot pay Gemini Developer API usage from Google AI Studio. The separate Gemini authorization project currently reports `billingEnabled: false`; keep it on the Free Tier and do not select `Set up billing`, prepay, or auto-reload for it.
- Budget alerts are useful observability, but they do not cap usage. Do not describe a budget as a hard spending limit.
- Do not configure automatic billing unlink/disable merely as a precaution. It stops project services and can put resources at risk; the non-billable trial boundary is the card-spend guardrail.
- Keep Cloud Run private until exposure is separately approved, with zero minimum instances, one maximum instance, CPU throttling, and Gemini Live disabled. Increase any of those limits only after a new cost and quota review.
- Keep only the small number of Artifact Registry images needed for the demo, and do not enable optional scanning or paid observability features without review.

The deployment helper verifies that project billing is enabled, but the CLI result does not prove that the linked account is still a Free Trial. The operator must verify the account type in Billing before deploying. If the account no longer says `Free trial account`, stop; do not deploy or activate anything.

## Naming and variables

Configure these deployment variables with your own private project and resource identifiers:

~~~bash
export PROJECT_ID="replace-with-project-id"
export REGION="us-central1"
export SERVICE_NAME="sapphireai"
export AR_REPOSITORY="sapphireai"
export IMAGE_NAME="web"
export RUNTIME_SERVICE_ACCOUNT="sapphireai-runtime"
export FIRESTORE_DATABASE_ID="(default)"
export GCS_BUCKET="replace-with-private-bucket-name"
export GEMINI_SECRET_NAME="sapphireai-gemini-api-key"
export SESSION_SECRET_NAME="sapphireai-session-signing-secret"
export GEMINI_AUTH_PROJECT_ID="replace-with-unbilled-gemini-project-id"
export MAX_INSTANCES="1"
export ENABLE_GEMINI_LIVE="false"
~~~

Do not substitute another project, region, or bucket without a new location, cost, and privacy review. The Gemini authorization project is identified here only for billing/quota auditing; the deployed application consumes the credential through Secret Manager and does not receive that project ID as client configuration.

## Install and authenticate the CLI

Follow the official [Google Cloud CLI installation guide](https://cloud.google.com/sdk/docs/install). Authentication may open a browser; do not use a personal browser session or expose tokens in screenshots.

Read-only checks after installation:

~~~bash
gcloud version
gcloud auth list
gcloud config get-value project
gcloud projects describe "$PROJECT_ID"
gcloud auth application-default print-access-token >/dev/null
~~~

The final command proves ADC exists without printing the token. Do not paste credentials or token output into logs, issues, chat, screenshots, or repository files.

## API preparation

The application project has the following required APIs enabled:

~~~text
run.googleapis.com
artifactregistry.googleapis.com
cloudbuild.googleapis.com
firestore.googleapis.com
storage.googleapis.com
secretmanager.googleapis.com
iam.googleapis.com
apikeys.googleapis.com
generativelanguage.googleapis.com
~~~

The separate Gemini authorization project has the Generative Language, API Keys, and IAM APIs needed to hold the restricted authorization key. It has no billing account attached.

Read-only status:

~~~bash
gcloud services list --enabled --project="$PROJECT_ID" --format="value(config.name)"
~~~

API enablement can affect billing and project policy. Run only after explicit approval:

~~~bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com iam.googleapis.com apikeys.googleapis.com generativelanguage.googleapis.com --project="$PROJECT_ID"
~~~

The deployment helper will report missing APIs and stop; it never enables them.

## Resource preparation

The resources in this section already exist. Creation commands are recovery/reference examples for an approved operator; do not rerun them merely because they appear here.

### Artifact Registry

Read-only:

~~~bash
gcloud artifacts repositories describe "$AR_REPOSITORY" --location="$REGION" --project="$PROJECT_ID"
~~~

Approved creation:

~~~bash
gcloud artifacts repositories create "$AR_REPOSITORY" --repository-format=docker --location="$REGION" --description="SapphireAI application images" --project="$PROJECT_ID"
~~~

The repository has the active, non-dry-run policy from `deployment/artifact-cleanup-policy.json`: delete images older than seven days and keep the three most recent images. Inspect the applied policy after every policy edit:

~~~bash
gcloud artifacts repositories describe "$AR_REPOSITORY" --location="$REGION" --project="$PROJECT_ID" --format="yaml(cleanupPolicies)"
~~~

### Firestore

Read-only:

~~~bash
gcloud firestore databases describe --database="$FIRESTORE_DATABASE_ID" --project="$PROJECT_ID"
~~~

Approved creation only after confirming location and Native mode:

~~~bash
gcloud firestore databases create --database="$FIRESTORE_DATABASE_ID" --location="$REGION" --type=firestore-native --project="$PROJECT_ID"
~~~

Do not let a script guess the Firestore location or replace an existing database.

Suggested collections:

~~~text
sessions/{sessionId}
sessions/{sessionId}/events/{zeroPaddedSequence}
sessions/{sessionId}/transcripts/{segmentId}
sessions/{sessionId}/snapshots/{snapshotId}
sessions/{sessionId}/reasoning/{analysisVersion}
sessions/{sessionId}/reports/final
rateLimits/{hashedPrincipalAndWindow}
~~~

Use a transaction to allocate the next event sequence and update session state. Store only validated payloads. Deletion must enumerate all subcollections and delete the related Storage prefix.

### Cloud Storage

Read-only:

~~~bash
gcloud storage buckets describe "gs://$GCS_BUCKET"
~~~

Approved creation:

~~~bash
gcloud storage buckets create "gs://$GCS_BUCKET" --project="$PROJECT_ID" --location="$REGION" --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=0
~~~

Never grant `allUsers` or `allAuthenticatedUsers` on the bucket. Use opaque object paths such as `sessions/<hashed-session>/<snapshot-id>.png`; serve content through an ownership-authorized application route. Configure CORS only if the architecture later proves direct signed access is necessary.

### Runtime service account

Read-only:

~~~bash
gcloud iam service-accounts describe "$RUNTIME_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID"
~~~

Approved creation:

~~~bash
gcloud iam service-accounts create "$RUNTIME_SERVICE_ACCOUNT" --display-name="SapphireAI Cloud Run runtime" --project="$PROJECT_ID"
~~~

Do not create or download a service-account key. Cloud Run supplies workload identity to the runtime.

### Secrets

The expected secret resources are:

- `sapphireai-gemini-api-key`
- `sapphireai-session-signing-secret`

The active Cloud Run template pins Gemini secret version `2` and session-signing secret version `1`. Never deploy a mutable `latest` reference. Numeric pinning makes a rotation an explicit new revision and prevents an unreviewed secret version from changing a running revision. Older enabled versions should be disabled or destroyed only after every serving revision has moved away from them and rollback implications have been reviewed.

Read-only:

~~~bash
gcloud secrets describe "$GEMINI_SECRET_NAME" --project="$PROJECT_ID"
gcloud secrets describe "$SESSION_SECRET_NAME" --project="$PROJECT_ID"
gcloud secrets versions list "$GEMINI_SECRET_NAME" --project="$PROJECT_ID" --filter="state=ENABLED"
gcloud secrets versions list "$SESSION_SECRET_NAME" --project="$PROJECT_ID" --filter="state=ENABLED"
~~~

Approved resource creation:

~~~bash
gcloud secrets create "$GEMINI_SECRET_NAME" --replication-policy=automatic --project="$PROJECT_ID"
gcloud secrets create "$SESSION_SECRET_NAME" --replication-policy=automatic --project="$PROJECT_ID"
~~~

Add values only through an approved secure operator flow. Do not place plaintext in command arguments, shell history, environment dumps, screenshots, or files in this repository. The deployment script validates secret resources/versions but never prompts for or writes secret material.

## Least-privilege IAM

### Runtime identity

| Scope | Role | Reason |
| --- | --- | --- |
| Approved project / Firestore | `roles/datastore.user` | Read/write application Firestore documents |
| Selected bucket only | `roles/storage.objectUser` | Create/read/delete selected snapshot objects, not manage bucket policy |
| Each named secret only | `roles/secretmanager.secretAccessor` | Resolve the two Cloud Run secret references |

Grant Storage access at the bucket, not project, level. Grant Secret Accessor separately on each secret, not project-wide.

Approved example bindings:

~~~bash
RUNTIME_MEMBER="serviceAccount:$RUNTIME_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$RUNTIME_MEMBER" --role="roles/datastore.user"
gcloud storage buckets add-iam-policy-binding "gs://$GCS_BUCKET" --member="$RUNTIME_MEMBER" --role="roles/storage.objectUser"
gcloud secrets add-iam-policy-binding "$GEMINI_SECRET_NAME" --project="$PROJECT_ID" --member="$RUNTIME_MEMBER" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding "$SESSION_SECRET_NAME" --project="$PROJECT_ID" --member="$RUNTIME_MEMBER" --role="roles/secretmanager.secretAccessor"
~~~

Cloud Run captures stdout/stderr without requiring application code to call the Logging API. Do not add broad Logging roles unless a direct Logging client is implemented and proven necessary.

### Deployer identity

The human or CI deployer normally needs narrowly scoped permissions equivalent to:

- Cloud Run Developer on the service;
- Service Account User on the runtime service account;
- Cloud Build submission permission;
- Artifact Registry upload/write permission; and
- read access to the named secrets for validation, without access to secret payloads unless separately authorized.

An administrator should grant roles at the smallest practical resource scope. Do not use Owner or Editor as a shortcut. Cloud Build’s build identity also needs permission to push to the selected Artifact Registry repository; inspect the actual project/build identity before binding anything.

## Build and deploy

The Dockerfile expects Next.js `output: "standalone"`. It uses Node.js 24, installs from `pnpm-lock.yaml`, copies standalone output, runs as a non-root user, listens on port 8080 by default, and checks `/api/health`.

Non-mutating plan:

~~~bash
bash scripts/deploy-cloud-run.sh plan
~~~

Read-only preflight after installing/authenticating `gcloud` and exporting the variables:

~~~bash
bash scripts/deploy-cloud-run.sh preflight
~~~

The deploy mode uses Cloud Build, so a local Docker daemon is not required. It consumes service quota or eligible trial credit and mutates remote state. Run only after reviewing the plan and receiving approval:

~~~bash
export CONFIRM_DEPLOY="deploy-sapphireai-$PROJECT_ID"
bash scripts/deploy-cloud-run.sh deploy
~~~

Deployment is private by default. Public exposure requires both:

~~~bash
export PUBLIC_DEPLOY="1"
export CONFIRM_PUBLIC="publish-sapphireai-$PROJECT_ID"
~~~

The deploy command:

1. reruns preflight;
2. submits the Docker build to Cloud Build;
3. deploys the immutable image to Cloud Run with min instances 0 and bounded max instances;
4. injects the two named Secret Manager versions;
5. sets model, repository, region, and feature configuration;
6. reads the resulting service URL;
7. sets `APP_BASE_URL` to that verified URL; and
8. calls the health endpoint using authenticated invocation for a private service.

A successful health check is not proof of the flagship journey. Browser QA and log inspection are still required.

## Verification

Read-only service inspection:

~~~bash
gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID"
gcloud run services get-iam-policy "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID"
gcloud run revisions list --service="$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID"
~~~

Private health check:

~~~bash
SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')"
IDENTITY_TOKEN="$(gcloud auth print-identity-token)"
curl --fail --silent --show-error --header "Authorization: Bearer $IDENTITY_TOKEN" "$SERVICE_URL/api/health"
unset IDENTITY_TOKEN
~~~

An unauthenticated request is expected to fail with `403` while the service remains private:

~~~bash
curl --silent --output /dev/null --write-out '%{http_code}\n' "$SERVICE_URL/api/health"
~~~

Log inspection without private payload output:

~~~bash
gcloud run services logs read "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --limit=100
~~~

Then use a clean browser to verify consent, mock/real label, text or Live flow, exact element focus, revision, report, replay, deletion, and subsequent not-found. Record the URL, revision, timestamp, browser, screenshots, console/network results, and limitations in `docs/QA_REPORT.md`.

## Rollback

List revisions, identify the last verified revision, and shift traffic only after review:

~~~bash
gcloud run revisions list --service="$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID"
gcloud run services update-traffic "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --to-revisions="VERIFIED_REVISION=100"
~~~

Rollback changes live traffic and therefore requires explicit approval.

## Teardown — documentation only

Teardown is destructive. Never run these commands automatically. First export any approved evidence, verify the exact project and resource names, and receive explicit approval for each category.

~~~bash
RUNTIME_MEMBER="serviceAccount:$RUNTIME_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects remove-iam-policy-binding "$PROJECT_ID" --member="$RUNTIME_MEMBER" --role="roles/datastore.user"
gcloud storage buckets remove-iam-policy-binding "gs://$GCS_BUCKET" --member="$RUNTIME_MEMBER" --role="roles/storage.objectUser"
gcloud secrets remove-iam-policy-binding "$GEMINI_SECRET_NAME" --project="$PROJECT_ID" --member="$RUNTIME_MEMBER" --role="roles/secretmanager.secretAccessor"
gcloud secrets remove-iam-policy-binding "$SESSION_SECRET_NAME" --project="$PROJECT_ID" --member="$RUNTIME_MEMBER" --role="roles/secretmanager.secretAccessor"
gcloud run services delete "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID"
gcloud artifacts repositories delete "$AR_REPOSITORY" --location="$REGION" --project="$PROJECT_ID"
gcloud storage rm --recursive "gs://$GCS_BUCKET/**"
gcloud storage buckets delete "gs://$GCS_BUCKET"
gcloud secrets delete "$GEMINI_SECRET_NAME" --project="$PROJECT_ID"
gcloud secrets delete "$SESSION_SECRET_NAME" --project="$PROJECT_ID"
gcloud iam service-accounts delete "$RUNTIME_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID"
~~~

Firestore database deletion is intentionally omitted from the routine teardown block because it destroys all database data and may have recovery/policy implications. Handle it as a separate, specifically approved operation using current official Firestore documentation.

Remove IAM bindings before deleting identities. Disabling APIs is project-wide and may break unrelated workloads; it is not part of this application teardown.

## Official references

- [Deploy container images to Cloud Run](https://cloud.google.com/run/docs/deploying)
- [Cloud Run deployment permissions](https://cloud.google.com/run/docs/reference/iam/roles)
- [Use Secret Manager secrets with Cloud Run](https://cloud.google.com/run/docs/configuring/services/secrets)
- [Create and manage Firestore databases](https://cloud.google.com/firestore/docs/manage-databases)
- [Create Cloud Storage buckets](https://cloud.google.com/storage/docs/creating-buckets)
- [Uniform bucket-level access](https://cloud.google.com/storage/docs/uniform-bucket-level-access)
- [Public access prevention](https://cloud.google.com/storage/docs/public-access-prevention)
- [Secret Manager create/access](https://cloud.google.com/secret-manager/docs/creating-and-accessing-secrets)
- [Google Cloud Free Program](https://cloud.google.com/free/docs/free-cloud-features)
- [Create and manage Cloud Billing budgets](https://cloud.google.com/billing/docs/how-to/budgets)
