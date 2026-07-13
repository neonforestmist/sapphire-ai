import { ReplayView } from "@/components/replay/replay-view";

export default async function InterviewReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReplayView sessionId={id} />;
}
