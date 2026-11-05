import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { BookOpen, Loader2 } from 'lucide-react';
import { Card, CardBody, InlineAlert } from '../../components/ui';
import { intel } from '../../lib/intel';

type Doc = { slug: string; title: string; body: string };

const GUIDES = [
  { slug: 'ml-learning-guide', title: 'ML learning guide' },
  { slug: 'classification-guide', title: 'Classification' },
  { slug: 'regression-guide', title: 'Regression' },
  { slug: 'clustering-guide', title: 'Clustering' },
  { slug: 'dataset-preparation', title: 'Dataset preparation' },
  { slug: 'metrics-reference', title: 'Metrics reference' },
  { slug: 'model-selection', title: 'Model selection' },
  { slug: 'csv-troubleshooting', title: 'CSV troubleshooting' },
  { slug: 'glossary', title: 'Glossary' },
] as const;

export function IntelDocs() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    intel.docs()
      .then((r) => setDocs(r.docs))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2"><BookOpen size={18} className="text-accent" /> Guides & reference</h1>
        <p className="text-xs text-txt-muted mt-0.5">Bundled offline documentation — no internet needed.</p>
      </header>
      {error && <InlineAlert kind="error">{error}</InlineAlert>}
      <div className="grid md:grid-cols-[220px_1fr] gap-4">
        <nav aria-label="Documentation" className="hidden md:block">
          <div className="flex flex-col gap-0.5 sticky top-6">
            <GuideLink to="/intelligence/docs" end title="Overview" />
            {GUIDES.map((g) => <GuideLink key={g.slug} to={`/intelligence/docs/${g.slug}`} title={g.title} />)}
          </div>
        </nav>
        <Card>
          <CardBody>
            {!docs ? (
              <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-accent" size={20} /></div>
            ) : (
              <Routes>
                <Route index element={<DocsHome docs={docs} />} />
                {GUIDES.map((g) => (
                  <Route key={g.slug} path={g.slug} element={<DocView docs={docs} slug={g.slug} fallbackTitle={g.title} />} />
                ))}
                <Route path="*" element={<InlineAlert kind="info">Pick a guide from the list.</InlineAlert>} />
              </Routes>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function GuideLink({ to, title, end }: { to: string; title: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-lg px-3 py-2 text-xs font-medium transition-colors ${isActive ? 'bg-accent/12 text-accent border border-accent/25' : 'text-txt-muted hover:text-txt hover:bg-ink-850'}`
      }
    >
      {title}
    </NavLink>
  );
}

function DocsHome({ docs }: { docs: Doc[] }) {
  return (
    <div className="space-y-3 text-xs leading-relaxed">
      <h2 className="text-sm font-semibold tracking-tight">Local machine learning, explained</h2>
      <p className="text-txt-muted">
        Intelligence runs a real scikit-learn engine on your device. These guides explain what each
        workflow does, how to prepare data, and how to read every metric honestly — including when a
        number <em>isn't</em> available.
      </p>
      <ul className="space-y-1.5">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <NavLink to={`/intelligence/docs/${g.slug}`} className="text-accent hover:underline">{g.title}</NavLink>
          </li>
        ))}
        {docs.length === 0 && (
          <li className="text-2xs text-txt-dim mt-2">Guide bodies will appear here after the first app launch registers its bundled documentation.</li>
        )}
      </ul>
    </div>
  );
}

function DocView({ docs, slug, fallbackTitle }: { docs: Doc[]; slug: string; fallbackTitle: string }) {
  const doc = docs.find((d) => d.slug === slug);
  return (
    <article className="text-xs leading-relaxed">
      <h2 className="text-sm font-semibold tracking-tight mb-3">{doc?.title ?? fallbackTitle}</h2>
      {doc?.body ? (
        <DocBody body={doc.body} />
      ) : (
        <p className="text-txt-dim">This guide is not present in this build's documentation bundle.</p>
      )}
    </article>
  );
}

/** Minimal, safe renderer for the bundled markdown-ish guides. */
function DocBody({ body }: { body: string }) {
  const blocks = body.split('\n\n');
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.startsWith('## ')) return <h3 key={i} className="text-xs font-semibold tracking-tight mt-4">{b.slice(3)}</h3>;
        if (b.startsWith('- ')) {
          return (
            <ul key={i} className="list-disc pl-4 space-y-1">
              {b.split('\n').filter((l) => l.startsWith('- ')).map((l, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: inline(l.slice(2)) }} />
              ))}
            </ul>
          );
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: inline(b) }} />;
      })}
    </div>
  );
}

/** Escape then allow *bold* / `code` only. */
function inline(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/&lt;code&gt;/g, '<code class="font-mono text-2xs bg-ink-800 px-1 py-0.5 rounded">')
    .replace(/`([^`]+)`/g, '<code class="font-mono text-2xs bg-ink-800 px-1 py-0.5 rounded">$1</code>');
}
