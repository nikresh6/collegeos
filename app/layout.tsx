import type {
  Metadata,
  Viewport,
} from "next";
import "./globals.css";
import {
  SchoolIdentityProvider,
} from "../components/school-identity";
import {
  LectureRecordingProvider,
} from "../components/lecture-recording-provider";
import {
  CourseMaterialManager,
} from "../components/course-material-manager";
import {
  LectureAnalysisActivity,
} from "../components/lecture-analysis-activity";
import {
  CommandCenter,
} from "../components/command-center";
import {
  AttentionCenter,
} from "../components/attention-center";
import {
  AssessmentFeedbackPrompt,
} from "../components/assessment-feedback-prompt";
import { GlobalNavigation } from "../components/global-navigation";
import { SolveAssistant } from "../components/solve-assistant";

export const metadata:
  Metadata = {
  title:
    "College Assistant",
  description:
    "A personal academic operating system for college.",
};

export const viewport:
  Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080809",
};

export default function RootLayout({
  children,
}: Readonly<{
  children:
    React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SchoolIdentityProvider>
          <LectureRecordingProvider>
            {children}
            <CourseMaterialManager />
            <LectureAnalysisActivity />
            <AttentionCenter />
            <CommandCenter />
            <SolveAssistant />
            <AssessmentFeedbackPrompt />
            <GlobalNavigation />
          </LectureRecordingProvider>
        </SchoolIdentityProvider>
      </body>
    </html>
  );
}
