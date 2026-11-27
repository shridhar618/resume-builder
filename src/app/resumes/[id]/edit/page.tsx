import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Editor } from "@/components/Editor";
import { activeProvider } from "@/lib/ai";
import { getOwnedResume } from "@/lib/resumes";
import { getSession, requireUser } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await getSession();
  const r = s ? await getOwnedResume(s.user.id, Number((await params).id)) : null;
  return { title: r?.title ?? "Editor" };
}

export default async function EditPage({ params }: Props) {
  const { id } = await params;
  const { user, csrf } = await requireUser(`/resumes/${id}/edit`);
  const resume = await getOwnedResume(user.id, Number(id));
  if (!resume) notFound();
  return <Editor resume={resume} csrf={csrf} provider={activeProvider()} />;
}
