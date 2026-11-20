import "server-only";
/**
 * Server-side PDF rendering with @react-pdf/renderer (no headless browser needed).
 *
 * Each template is a small component that turns normalised resume data into PDF primitives.
 * Output is real text (selectable, ATS-parsable), not an image. Sizes, fonts and colours
 * mirror the HTML preview in components/ResumeView.tsx.
 */
import { Document, Font, Link, Page, Text, View, renderToBuffer, type Styles } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import {
  CONTACT_FIELDS,
  LINK_FIELDS,
  dates,
  href,
  joinTruthy,
  type ResumeData,
  type TemplateKey,
} from "./resumeModel";

const mm = (n: number) => n * 2.8346;

// Resume text shouldn't be hyphenated mid-word.
Font.registerHyphenationCallback((word) => [word]);

// The standard PDF fonts only cover WinAnsi (Western European). Map common symbols and
// replace anything else so it never renders as garbage.
const REPLACE: Record<string, string> = { "→": "->", "←": "<-", "₹": "Rs.", "✓": "-" };
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function pdfText(text: string | undefined): string {
  return Array.from(text ?? "")
    .map((ch) => {
      if (REPLACE[ch]) return REPLACE[ch];
      const c = ch.codePointAt(0)!;
      if (c === 9 || c === 10 || (c >= 32 && c < 127) || (c >= 160 && c <= 255) || WIN_ANSI_EXTRA.has(ch)) return ch;
      return "?";
    })
    .join("");
}

type FontSpec = { family: "Helvetica" | "Times-Roman"; bold?: boolean; italic?: boolean };
type TextStyle = { font: FontSpec; size: number; leading: number; color?: string; align?: "left" | "center" | "right" };

const ts = (s: TextStyle) => ({
  fontFamily: s.font.family,
  fontWeight: s.font.bold ? ("bold" as const) : ("normal" as const),
  fontStyle: s.font.italic ? ("italic" as const) : ("normal" as const),
  fontSize: s.size,
  lineHeight: s.leading / s.size,
  color: s.color ?? "#000000",
  textAlign: s.align ?? "left",
});

type Theme = {
  margin: number;
  linkColor?: string;
  name: TextStyle;
  headline: TextStyle;
  contact: TextStyle;
  contactSep: string;
  h: TextStyle & { spaceBefore: number; spaceAfter?: number };
  rule?: { thickness: number; color: string };
  title: TextStyle;
  sub: TextStyle;
  date: TextStyle;
  body: TextStyle;
  bullet: TextStyle & { indent: number };
  entryGap: number;
  rail?: number; // minimal: dates in a left column
};

const H = (bold = false, italic = false): FontSpec => ({ family: "Helvetica", bold, italic });
const T = (bold = false, italic = false): FontSpec => ({ family: "Times-Roman", bold, italic });

const THEMES: Record<TemplateKey, Theme> = {
  modern: {
    margin: mm(14),
    linkColor: "#1f4e79",
    name: { font: H(true), size: 22, leading: 26, color: "#ffffff" },
    headline: { font: H(), size: 11.5, leading: 15, color: "#d6e4f0" },
    contact: { font: H(), size: 8.8, leading: 12, color: "#ffffff" },
    contactSep: "  |  ",
    h: { font: H(true), size: 11, leading: 14, color: "#1f4e79", spaceBefore: 8 },
    rule: { thickness: 1.2, color: "#1f4e79" },
    title: { font: H(true), size: 10, leading: 13 },
    sub: { font: H(false, true), size: 9.2, leading: 12, color: "#444444" },
    date: { font: H(), size: 9, leading: 13, color: "#555555", align: "right" },
    body: { font: H(), size: 9.4, leading: 12.6 },
    bullet: { font: H(), size: 9.4, leading: 12.4, indent: 11 },
    entryGap: 4,
  },
  classic: {
    margin: mm(18),
    name: { font: T(true), size: 22, leading: 26, align: "center" },
    headline: { font: T(false, true), size: 12, leading: 15, align: "center" },
    contact: { font: T(), size: 10, leading: 13, align: "center" },
    contactSep: " · ",
    h: { font: T(true), size: 12, leading: 15, spaceBefore: 9 },
    rule: { thickness: 0.5, color: "#000000" },
    title: { font: T(true), size: 11, leading: 13.5 },
    sub: { font: T(false, true), size: 10.5, leading: 13 },
    date: { font: T(), size: 10.5, leading: 13.5, align: "right" },
    body: { font: T(), size: 10.6, leading: 13.6 },
    bullet: { font: T(), size: 10.6, leading: 13.4, indent: 12 },
    entryGap: 4,
  },
  minimal: {
    margin: mm(16),
    linkColor: "#2563eb",
    name: { font: H(true), size: 20, leading: 24, color: "#111827" },
    headline: { font: H(), size: 11, leading: 14, color: "#6b7280" },
    contact: { font: H(), size: 8.8, leading: 12, color: "#374151" },
    contactSep: "  ·  ",
    h: { font: H(true), size: 9, leading: 12, color: "#6b7280", spaceBefore: 10, spaceAfter: 4 },
    title: { font: H(true), size: 9.8, leading: 12.5, color: "#111827" },
    sub: { font: H(), size: 9.2, leading: 12, color: "#6b7280" },
    date: { font: H(), size: 8.6, leading: 12.5, color: "#6b7280" },
    body: { font: H(), size: 9.3, leading: 12.6, color: "#1f2937" },
    bullet: { font: H(), size: 9.3, leading: 12.4, color: "#1f2937", indent: 10 },
    entryGap: 5,
    rail: mm(38),
  },
};

// ============================================================================ building blocks
function PdfLink({ value, color }: { value: string; color?: string }) {
  return (
    <Link src={href(value)} style={{ color: color ?? "inherit", textDecoration: "none" }}>
      {pdfText(value)}
    </Link>
  );
}

function Bullets({ items, th }: { items: string[]; th: Theme }) {
  const indent = th.bullet.indent + (th.rail ?? 0);
  return (
    <>
      {items.map((b, i) => (
        <View key={i} style={{ flexDirection: "row", paddingLeft: indent - 9 }}>
          <Text style={{ ...ts(th.bullet), width: 9 }}>•</Text>
          <Text style={{ ...ts(th.bullet), flex: 1 }}>{pdfText(b)}</Text>
        </View>
      ))}
    </>
  );
}

function SectionHeading({ title, th }: { title: string; th: Theme }) {
  return (
    <View style={{ marginTop: th.h.spaceBefore, marginBottom: th.h.spaceAfter ?? 0 }}>
      <Text style={ts(th.h)}>{title.toUpperCase()}</Text>
      {th.rule && (
        <View style={{ borderBottomWidth: th.rule.thickness, borderBottomColor: th.rule.color, marginTop: 1, marginBottom: 4 }} />
      )}
    </View>
  );
}

function EntryHeader({ title, sub, dateText, th }: { title: string; sub?: ReactNode; dateText: string; th: Theme }) {
  const main = (
    <View style={{ flex: 1 }}>
      <Text style={ts(th.title)}>{pdfText(title)}</Text>
      {sub ? <Text style={ts(th.sub)}>{sub}</Text> : null}
    </View>
  );
  if (th.rail) {
    return (
      <View style={{ flexDirection: "row", marginBottom: 1 }}>
        <Text style={{ ...ts(th.date), width: th.rail }}>{pdfText(dateText)}</Text>
        {main}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", marginBottom: 2 }}>
      {main}
      <Text style={{ ...ts(th.date), width: mm(38) }}>{pdfText(dateText)}</Text>
    </View>
  );
}

function BodyText({ th, children }: { th: Theme; children: ReactNode }) {
  return <Text style={{ ...ts(th.body), marginBottom: 2, paddingLeft: th.rail ?? 0 }}>{children}</Text>;
}

const SECTION_TITLES = {
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  skills: "Skills",
  certifications: "Certifications",
  achievements: "Achievements",
} as const;

function sectionEntries(d: ResumeData, sec: keyof typeof SECTION_TITLES, th: Theme): ReactNode[] {
  switch (sec) {
    case "experience":
      return d.experience.map((e, i) => (
        <View key={i}>
          <EntryHeader title={e.role} sub={pdfText(joinTruthy([e.company, e.location], ", "))} dateText={dates(e)} th={th} />
          <Bullets items={e.bullets} th={th} />
        </View>
      ));
    case "projects":
      return d.projects.map((p, i) => {
        const sub =
          p.tech || p.link ? (
            <>
              {pdfText(p.tech)}
              {p.tech && p.link ? " · " : ""}
              {p.link ? <PdfLink value={p.link} color={th.linkColor} /> : null}
            </>
          ) : null;
        return (
          <View key={i}>
            <EntryHeader title={p.name} sub={sub} dateText="" th={th} />
            <Bullets items={p.bullets} th={th} />
          </View>
        );
      });
    case "education":
      return d.education.map((e, i) => {
        let sub = joinTruthy([e.school, e.location], ", ");
        if (e.score) sub = (sub ? sub + " · " : "") + e.score;
        return <EntryHeader key={i} title={e.degree} sub={pdfText(sub)} dateText={dates(e)} th={th} />;
      });
    case "skills":
      return d.skills.map((s, i) => (
        <BodyText key={i} th={th}>
          {s.category ? <Text style={{ fontWeight: "bold" }}>{pdfText(s.category)}: </Text> : null}
          {pdfText(s.items.join(", "))}
        </BodyText>
      ));
    case "certifications":
      return d.certifications.map((c, i) => {
        const extra = joinTruthy([c.issuer, c.date], " · ");
        return (
          <BodyText key={i} th={th}>
            <Text style={{ fontWeight: "bold" }}>{pdfText(c.name)}</Text>
            {extra ? ` — ${pdfText(extra)}` : ""}
          </BodyText>
        );
      });
    case "achievements":
      return d.achievements.map((a, i) => <Bullets key={i} items={[a]} th={th} />);
  }
}

function Body({ d, th }: { d: ResumeData; th: Theme }) {
  return (
    <>
      {d.summary ? (
        <View wrap={false}>
          <SectionHeading title="Summary" th={th} />
          <BodyText th={th}>{pdfText(d.summary)}</BodyText>
        </View>
      ) : null}
      {(Object.keys(SECTION_TITLES) as (keyof typeof SECTION_TITLES)[]).map((sec) => {
        const entries = sectionEntries(d, sec, th);
        if (!entries.length) return null;
        return entries.map((entry, i) => (
          // Each entry stays on one page; the heading travels with the first entry so it never orphans.
          <View key={`${sec}-${i}`} wrap={false} style={{ marginBottom: th.entryGap }}>
            {i === 0 ? <SectionHeading title={SECTION_TITLES[sec]} th={th} /> : null}
            {entry}
          </View>
        ));
      })}
    </>
  );
}

function ContactLine({ d, th, linkColor }: { d: ResumeData; th: Theme; linkColor?: string }) {
  const bits = CONTACT_FIELDS.filter((f) => d.personal[f]);
  if (!bits.length) return null;
  // One box per item so lines only ever break between items (never inside a separator).
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: th.contact.align === "center" ? "center" : "flex-start" }}>
      {bits.map((f, i) => (
        <Text key={f} style={ts(th.contact)}>
          {LINK_FIELDS.has(f) ? <PdfLink value={d.personal[f]} color={linkColor} /> : pdfText(d.personal[f])}
          {i < bits.length - 1 ? th.contactSep.replace(/ /g, "\u00a0") : ""}
        </Text>
      ))}
    </View>
  );
}

// ============================================================================ templates
function Header({ d, template, th }: { d: ResumeData; template: TemplateKey; th: Theme }) {
  const p = d.personal;
  const name = <Text style={ts(th.name)}>{pdfText(p.full_name || "Your Name")}</Text>;
  const headline = p.headline ? <Text style={ts(th.headline)}>{pdfText(p.headline)}</Text> : null;

  if (template === "modern") {
    return (
      <View style={{ backgroundColor: "#1f4e79", paddingHorizontal: 12, paddingTop: 12, paddingBottom: 11, marginBottom: 4 }}>
        {name}
        {headline ? <View style={{ marginTop: 2 }}>{headline}</View> : null}
        <View style={{ marginTop: 2 }}>
          <ContactLine d={d} th={th} linkColor="#ffffff" />
        </View>
      </View>
    );
  }
  if (template === "classic") {
    return (
      <View style={{ borderBottomWidth: 1.4, borderBottomColor: "#000000", paddingBottom: 6 }}>
        {name}
        {headline}
        <ContactLine d={d} th={th} />
      </View>
    );
  }
  return (
    <View style={{ marginBottom: 2 }}>
      {name}
      {headline}
      <View style={{ marginTop: 3 }}>
        <ContactLine d={d} th={th} linkColor="#374151" />
      </View>
    </View>
  );
}

export function ResumePdf({ data, template, title }: { data: ResumeData; template: TemplateKey; title: string }) {
  const th = THEMES[template] ?? THEMES.modern;
  const name = data.personal.full_name;
  const styles: Styles = { page: { padding: th.margin, backgroundColor: "#ffffff" } };
  return (
    <Document
      title={name ? `${pdfText(name)} – Resume` : title}
      author={name ? pdfText(name) : "Resume Builder"}
      subject={data.target_role || "Resume"}
      creator="AI Resume Builder"
      producer="AI Resume Builder"
    >
      <Page size="A4" style={styles.page}>
        <Header d={data} template={template} th={th} />
        <Body d={data} th={th} />
      </Page>
    </Document>
  );
}

export async function renderPdf(data: ResumeData, template: TemplateKey, title = "Resume"): Promise<Buffer> {
  return renderToBuffer(<ResumePdf data={data} template={template} title={title} />);
}
