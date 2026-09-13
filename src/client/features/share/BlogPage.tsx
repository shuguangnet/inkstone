import { useEffect, useState } from 'react';
import { BookOpen, Moon, Sun } from 'lucide-react';
import type { PublicBlog } from '@shared/types';
import { api } from '../../lib/api';
import { fullTime } from '../../lib/time';
import { Logo } from '../../components/primitives';
import { LoadingBlock } from '../../components/feedback';
import { t } from '../../lib/i18n';

/** Public front page of a published blog/wiki collection at /s/blog/:slug. */
export function BlogPage({ slug }: {
    slug: string;
}) {
    const [blog, setBlog] = useState<PublicBlog | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

    useEffect(() => {
        const controller = new AbortController();
        api.share.blog(slug, controller.signal)
            .then((result) => setBlog(result))
            .catch((err) => {
                if ((err as Error)?.name !== 'AbortError') setError(err instanceof Error ? err.message : String(err));
            });
        return () => controller.abort();
    }, [slug]);

    useEffect(() => {
        document.title = blog ? `${blog.title} · ${blog.siteName}` : originalTitle();
    }, [blog]);

    return (<div className="min-h-screen bg-[var(--bg-editor)] text-[var(--text-primary)]" data-theme={dark ? 'dark' : 'light'}>
      <header className="mx-auto flex max-w-[720px] items-center justify-between px-5 pt-8">
        <div className="flex items-center gap-2 opacity-80"><Logo size={22}/><span className="text-xs font-semibold tracking-[0.08em] text-[var(--text-tertiary)]">{blog?.siteName ?? ''}</span></div>
        <button type="button" aria-label={t("share.toggle_theme")} className="rounded-[var(--r-md)] p-1.5 hover:bg-[var(--bg-hover)]" onClick={() => {
            const next = !dark;
            setDark(next);
            document.documentElement.dataset.theme = next ? 'dark' : 'light';
        }}>
          {dark ? <Sun size={15}/> : <Moon size={15}/>}
        </button>
      </header>
      <main className="mx-auto max-w-[720px] px-5 pb-24 pt-6">
        {error !== null && <p className="text-sm text-[var(--danger)]">{error}</p>}
        {blog === null && error === null && <LoadingBlock label={t("share.loading")}/>}
        {blog !== null && (<>
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <BookOpen size={18}/>
            <span className="text-[11px] font-semibold tracking-[0.08em] uppercase">{t("share.blog")}</span>
          </div>
          <h1 className="mt-2 font-serif text-[30px] leading-tight">{blog.title}</h1>
          <p className="mt-1 text-xs text-[var(--text-quaternary)]">
            {t("share.post_count", { count: String(blog.posts.length) })}
          </p>
          <div className="mt-8 space-y-7">
            {blog.posts.map((post) => (<article key={post.slug}>
              <h2 className="text-[19px] leading-snug">
                <a className="hover:text-[var(--accent)]" href={`/s/${post.slug}`}>{post.title}</a>
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--text-quaternary)]">{fullTime(post.updatedAt)}</p>
              {post.excerpt !== '' && <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-tertiary)]">{post.excerpt}</p>}
            </article>))}
            {blog.posts.length === 0 && <p className="text-sm text-[var(--text-quaternary)]">{t("share.blog_empty")}</p>}
          </div>
        </>)}
      </main>
    </div>)
}

function originalTitle(): string {
    return document.title;
}
