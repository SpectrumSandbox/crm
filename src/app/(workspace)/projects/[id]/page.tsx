"use client";

import { useParams } from "next/navigation";
import { ProjectRegisterView } from "@/components/projects/project-register";

export default function ProjectRegisterPage() {
  const { id } = useParams<{ id: string }>();
  return <ProjectRegisterView id={id} />;
}
