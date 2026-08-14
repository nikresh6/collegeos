import type {
  Metadata,
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

export const metadata:
  Metadata = {
  title:
    "College Assistant",
  description:
    "A personal academic operating system for college.",
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
          </LectureRecordingProvider>
        </SchoolIdentityProvider>
      </body>
    </html>
  );
}