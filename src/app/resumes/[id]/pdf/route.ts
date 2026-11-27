import { NextResponse } from "next/server";
import { renderPdf } from "@/lib/pdf";
import { getOwnedResume, pdfFilename } from "@/lib/resumes";
import { getSession } from "@/lib/session";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname)}`, url));
  const resume = await getOwnedResume(session.user.id, Number(id));
  if (!resume) return new NextResponse("Not found", { status: 404 });

  const pdf = await renderPdf(resume.data, resume.template, resume.title);
  const disposition = url.searchParams.get("inline") ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${pdfFilename(resume)}"`,
      "Cache-Control": "no-store",
    },
  });
}
