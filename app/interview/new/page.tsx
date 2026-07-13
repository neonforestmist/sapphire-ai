import type { Metadata } from "next";
import { InterviewSetup } from "@/components/interview/interview-setup";

export const metadata: Metadata = { title: "Start an interview" };

export default function NewInterviewPage() {
  return <InterviewSetup />;
}
