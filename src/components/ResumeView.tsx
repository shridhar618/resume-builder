import { CONTACT_FIELDS, LINK_FIELDS, dates, href, joinTruthy, type ResumeData, type TemplateKey } from "@/lib/resumeModel";

/**
 * HTML rendering of a resume, used for the editor's live preview and dashboard thumbnails.
 * Template styling lives in globals.css under .rv-<template>. React escapes all text.
 */
export function ResumeView({ data: r, template }: { data: ResumeData; template: TemplateKey }) {
  const p = r.personal;
  const contacts = CONTACT_FIELDS.filter((f) => p[f]);
  const empty = !(r.summary || r.experience.length || r.projects.length || r.education.length || r.skills.length);

  return (
    <div className={`rv rv-${template}`}>
      <div className="hdr">
        <h1>{p.full_name || "Your Name"}</h1>
        {p.headline && <div className="headline">{p.headline}</div>}
        <div className="contact">
          {contacts.map((f) => (
            <span key={f}>{LINK_FIELDS.has(f) ? <a href={href(p[f])}>{p[f]}</a> : p[f]}</span>
          ))}
        </div>
      </div>

      <div className="content">
        {r.summary && (
          <section>
            <h2>Summary</h2>
            <p className="summary">{r.summary}</p>
          </section>
        )}

        {r.experience.length > 0 && (
          <section>
            <h2>Experience</h2>
            {r.experience.map((e, i) => (
              <div className="entry" key={i}>
                <div className="entry-top">
                  <div className="entry-main">
                    <div className="entry-title">{e.role}</div>
                    {(e.company || e.location) && <div className="entry-sub">{joinTruthy([e.company, e.location], ", ")}</div>}
                  </div>
                  <div className="entry-dates">{dates(e)}</div>
                </div>
                {e.bullets.length > 0 && (
                  <ul>
                    {e.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}

        {r.projects.length > 0 && (
          <section>
            <h2>Projects</h2>
            {r.projects.map((pr, i) => (
              <div className="entry" key={i}>
                <div className="entry-top">
                  <div className="entry-main">
                    <div className="entry-title">{pr.name}</div>
                    {(pr.tech || pr.link) && (
                      <div className="entry-sub">
                        {pr.tech}
                        {pr.tech && pr.link && " · "}
                        {pr.link && (
                          <a className="link" href={href(pr.link)}>
                            {pr.link}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="entry-dates" />
                </div>
                {pr.bullets.length > 0 && (
                  <ul>
                    {pr.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}

        {r.education.length > 0 && (
          <section>
            <h2>Education</h2>
            {r.education.map((ed, i) => (
              <div className="entry" key={i}>
                <div className="entry-top">
                  <div className="entry-main">
                    <div className="entry-title">{ed.degree}</div>
                    <div className="entry-sub">
                      {joinTruthy([ed.school, ed.location], ", ")}
                      {ed.score && ` · ${ed.score}`}
                    </div>
                  </div>
                  <div className="entry-dates">{dates(ed)}</div>
                </div>
              </div>
            ))}
          </section>
        )}

        {r.skills.length > 0 && (
          <section>
            <h2>Skills</h2>
            {r.skills.map((s, i) => (
              <p className="skill-line" key={i}>
                {s.category && <b>{s.category}: </b>}
                {s.items.join(", ")}
              </p>
            ))}
          </section>
        )}

        {r.certifications.length > 0 && (
          <section>
            <h2>Certifications</h2>
            {r.certifications.map((c, i) => (
              <p className="skill-line" key={i}>
                <b>{c.name}</b>
                {(c.issuer || c.date) && ` — ${joinTruthy([c.issuer, c.date], " · ")}`}
              </p>
            ))}
          </section>
        )}

        {r.achievements.length > 0 && (
          <section>
            <h2>Achievements</h2>
            <ul className="ach">
              {r.achievements.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </section>
        )}

        {empty && <p className="placeholder">Start filling in sections on the left — the preview updates as you type.</p>}
      </div>
    </div>
  );
}
