import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cvs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUserOrNull } from "@/lib/auth/session";
import { generateHarvardCv } from "@/lib/latex/template";
import { compileLatex, CompileError } from "@/lib/latex/compile";

/**
 * GET /api/pdf/[cvId]
 * Generates and returns a downloadable PDF for the specified CV.
 * - If cv.texSource exists and is non-empty, uses it directly.
 * - Otherwise generates it from cv.contentJson using generateHarvardCv().
 * - Returns the PDF as a downloadable file.
 * Returns 403 if not the owner.
 * Returns 500 if compilation fails.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cvId: string }> },
) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cvId } = await params;

  const [cv] = await db.select().from(cvs).where(eq(cvs.id, cvId)).limit(1);
  if (!cv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (cv.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Determine LaTeX source
  const texSource =
    cv.texSource && cv.texSource.trim().length > 0
      ? cv.texSource
      : generateHarvardCv(cv.contentJson);

  try {
    const pdfBuffer = await compileLatex(texSource);

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cv.pdf"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (err) {
    if (err instanceof CompileError) {
      return NextResponse.json(
        { error: "Compilation failed", details: err.message, log: err.log },
        { status: 500 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Compilation failed", details: message },
      { status: 500 },
    );
  }
}
