"use client";
import { useEffect, useMemo, useState } from "react";
import "./central-cover.css";

type CatalogFile = {
  id: number;
  examCategory: string;
  bookTitle: string;
  fileName: string;
  subject: string;
  documentType: string;
  questionCount: number;
};
type Product = {
  productKey: string;
  title: string;
  category: string;
  centralCoverKey: string | null;
  listPrice: number;
  salePrice: number | null;
  saleLabel: string;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  accessDays: number;
  trialQuestions: number;
  status: string;
};
type Book = {
  title: string;
  category: string;
  categories: Set<string>;
  subjects: Set<string>;
  documentIds: number[];
  files: number;
  questions: number;
};
type ChapterPreview = {
  total: number;
  published: number;
  draft: number;
  unassigned: number;
  ready: boolean;
  chapters: Array<{ number: number; title: string; pageStart: number; pageEnd: number; count: number }>;
};
const normalized = (value: string) =>
  value
    .replace(/\.pdf$/iu, "")
    .replace(/[（）()\s_－—-]/gu, "")
    .replace(/全書$/u, "")
    .toLocaleLowerCase("zh-TW");
const PAGE_SIZE = 6;
const categoryLabel = (value: string) =>
  value === "accounting"
    ? "會計"
    : value === "medtech"
      ? "醫檢"
      : value === "law"
        ? "法律"
        : "資構";
const categoryOrder = ["accounting", "medtech", "law", "datastruct"];

export default function CentralBookCatalog() {
  const [files, setFiles] = useState<CatalogFile[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [previews, setPreviews] = useState<Record<number, ChapterPreview>>({});
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [bookPages, setBookPages] = useState<Record<string, number>>({});
  const [productPages, setProductPages] = useState<Record<string, number>>({});
  async function load() {
    const [a, b] = await Promise.all([
      fetch("/api/admin/question-bank-summary", { cache: "no-store" }),
      fetch("/api/admin/products", { cache: "no-store" }),
    ]);
    const [docs, catalog] = await Promise.all([a.json(), b.json()]);
    setFiles(docs.files ?? []);
    setProducts(catalog.products ?? []);
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    for (const file of files.filter((item) => /51MM320901|會研所.*題庫制霸/u.test(item.fileName + item.bookTitle))) {
      void fetch(`/api/admin/accounting-chapter-preview?documentId=${file.id}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((data) => setPreviews((current) => ({ ...current, [file.id]: data })));
    }
  }, [files]);
  const books = useMemo(() => {
    const map = new Map<string, Book>();
    for (const file of files) {
      const title = (
          file.bookTitle || file.fileName.replace(/\.pdf$/iu, "")
        ).trim(),
        key = normalized(title),
        row = map.get(key) ?? {
          title,
          category: file.examCategory,
          categories: new Set<string>(),
          subjects: new Set<string>(),
          documentIds: [],
          files: 0,
          questions: 0,
        };
      row.categories.add(file.examCategory);
      row.subjects.add(file.subject);
      row.documentIds.push(file.id);
      row.files++;
      row.questions += Number(file.questionCount || 0);
      map.set(key, row);
    }
    const needle = normalized(query);
    return [...map.values()]
      .filter((row) => !needle || normalized(row.title).includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-TW"));
  }, [files, query]);
  const bookGroups = useMemo(
    () =>
      categoryOrder
        .map((category) => ({
          category,
          rows: books.filter((book) => book.category === category),
        }))
        .filter((group) => group.rows.length),
    [books],
  );
  const productGroups = useMemo(() => {
    const needle = normalized(query);
    return categoryOrder
      .map((category) => ({
        category,
        rows: products
          .filter(
            (product) =>
              product.category === category &&
              (!needle || normalized(product.title).includes(needle)),
          )
          .sort((a, b) => a.title.localeCompare(b.title, "zh-TW")),
      }))
      .filter((group) => group.rows.length);
  }, [products, query]);
  useEffect(() => {
    setBookPages({});
    setProductPages({});
  }, [query]);
  function match(title: string) {
    const key = normalized(title);
    return products.find((product) => {
      const p = normalized(product.title);
      return p === key || p.includes(key) || key.includes(p);
    });
  }
  function change(productKey: string, patch: Partial<Product>) {
    setProducts((rows) =>
      rows.map((row) =>
        row.productKey === productKey ? { ...row, ...patch } : row,
      ),
    );
  }
  async function publish(book: Book) {
    const preview = book.documentIds.map((id) => previews[id]).find(Boolean);
    const remaining = preview?.draft ?? book.questions;
    if (!window.confirm(`確定發布「${book.title}」剩餘的 ${remaining.toLocaleString()} 題草稿？已發布題目不會重複處理。`)) return;
    const key = normalized(book.title);
    setBusy(`publish:${key}`);
    const response = await fetch("/api/admin/publish-document-questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentIds: book.documentIds }),
    });
    const data = await response.json();
    setBusy("");
    setNotice(
      response.ok
        ? `「${book.title}」已發布 ${data.updated ?? 0} 題${data.blocked ? `；另有 ${data.blocked} 題缺老師擬答，暫不發布` : ""}。`
        : (data.error ?? "發布失敗"),
    );
    await load();
  }
  async function create(title: string, category: string) {
    if (!["accounting", "medtech"].includes(category))
      return setNotice(
        "目前只有會計與醫檢教材可建立學生商品；法律教材由老師專區管理。",
      );
    setBusy(normalized(title));
    const response = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, category }),
    });
    const data = await response.json();
    setBusy("");
    if (!response.ok) return setNotice(data.error || "建立商品失敗");
    setNotice(`已建立「${title}」商品設定。`);
    await load();
  }
  async function save(product: Product) {
    setBusy(product.productKey);
    const response = await fetch("/api/admin/products", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(product),
    });
    const data = await response.json();
    setBusy("");
    if (!response.ok) return setNotice(data.error || "儲存失敗");
    setNotice(`「${product.title}」商品設定已儲存。`);
    await load();
  }
  return (
    <>
      <section className="central-book-catalog">
        <header>
          <div>
            <h2>教材與題庫發布管理</h2>
            <p>每本書獨立發布，不會誤發布其他類科或其他教材的草稿題目。</p>
          </div>
          <label>
            搜尋教材
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="輸入完整或部分書名"
            />
          </label>
        </header>
        {notice && <p className="central-catalog-notice">{notice}</p>}
        <div className="central-category-groups">
          {bookGroups.map(({ category, rows }) => {
            const page = Math.min(
              bookPages[category] ?? 1,
              Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
            );
            const visibleRows = rows.slice(
              (page - 1) * PAGE_SIZE,
              page * PAGE_SIZE,
            );
            return <details key={`${category}:${Boolean(query)}`} open={query ? true : undefined}>
              <summary>
                <span><b>{categoryLabel(category)}</b>{rows.length} 本教材</span>
                <small>{rows.reduce((sum, row) => sum + row.questions, 0).toLocaleString()} 題</small>
              </summary>
              <div className="central-book-grid">
          {visibleRows.map((book) => {
            const product = match(book.title),
              key = normalized(book.title),
              preview = book.documentIds.map((id) => previews[id]).find(Boolean);
            return (
              <article key={key}>
                <div>
                  <span>
                    {[...book.categories]
                      .map(categoryLabel)
                      .join("／")}
                  </span>
                  <h3>{book.title}</h3>
                  <p>
                    {[...book.subjects].join("、")}・{book.files} 份文件・
                    {book.questions.toLocaleString()} 題
                  </p>
                  {preview && (
                    <section className="central-chapter-preview">
                      <header><b>PDF頁碼章節對應</b><span>{preview.ready ? `18章已對應・待發布 ${preview.draft} 題` : `尚有 ${preview.unassigned} 題未對應，暫不可發布`}</span></header>
                      <div>{preview.chapters.map((chapter) => <span key={chapter.number}><b>{chapter.number}</b>{chapter.title}<small>PDF {chapter.pageStart}–{chapter.pageEnd}・{chapter.count}題</small></span>)}</div>
                    </section>
                  )}
                </div>
                <div className="central-publish-actions">
                  <button
                    className="publish-book"
                    disabled={!book.questions || busy === `publish:${key}` || Boolean(preview && (!preview.ready || preview.draft === 0))}
                    onClick={() => void publish(book)}
                  >
                    {busy === `publish:${key}`
                      ? "發布中…"
                      : preview && !preview.ready
                        ? "章節尚未對應完成"
                        : preview
                          ? preview.draft > 0
                            ? `發布剩餘 ${preview.draft.toLocaleString()} 題`
                            : "本書題目已全部發布"
                          : `發布本書 ${book.questions.toLocaleString()} 題`}
                  </button>
                  {product ? (
                    <b className="ready">已有商品設定</b>
                  ) : (
                    <button
                      disabled={busy === key}
                      onClick={() => void create(book.title, book.category)}
                    >
                      {busy === key ? "建立中…" : "建立商品設定"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
              </div>
              {rows.length > PAGE_SIZE && <nav className="central-pagination" aria-label={`${categoryLabel(category)}教材分頁`}>
                <button disabled={page === 1} onClick={() => setBookPages((current) => ({ ...current, [category]: page - 1 }))}>上一頁</button>
                <span>第 {page}／{Math.ceil(rows.length / PAGE_SIZE)} 頁</span>
                <button disabled={page === Math.ceil(rows.length / PAGE_SIZE)} onClick={() => setBookPages((current) => ({ ...current, [category]: page + 1 }))}>下一頁</button>
              </nav>}
            </details>;
          })}
          {!books.length && <p>目前找不到符合條件的教材。</p>}
        </div>
      </section>
      <section className="central-created-products">
        <header>
          <h2>學生商品與權限設定</h2>
          <span>{products.length} 本</span>
        </header>
        <div className="central-category-groups">
        {productGroups.map(({ category, rows }) => {
          const page = Math.min(
            productPages[category] ?? 1,
            Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
          );
          const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          return <details key={`${category}:${Boolean(query)}`} open={query ? true : undefined}>
            <summary>
              <span><b>{categoryLabel(category)}</b>{rows.length} 本商品</span>
              <small>點擊展開設定</small>
            </summary>
            <div className="central-product-list">
        {visibleRows.map((product) => {
          const cover = `/api/admin/products/cover?${new URLSearchParams({ category: product.category, productKey: product.productKey })}`;
          return (
            <article key={product.category + product.productKey}>
              <div className="central-product-cover">
                {product.centralCoverKey ? (
                  <img src={cover} alt={`${product.title}書封`} />
                ) : (
                  <span>
                    尚無
                    <br />
                    書封
                  </span>
                )}
              </div>
              <div className="central-created-title">
                <span>
                  {product.category === "accounting" ? "會計" : "醫檢"}
                </span>
                <h3>{product.title}</h3>
              </div>
              <div className="central-created-fields">
                <label>
                  狀態
                  <select
                    value={product.status}
                    onChange={(event) =>
                      change(product.productKey, { status: event.target.value })
                    }
                  >
                    <option value="draft">草稿</option>
                    <option value="active">上架</option>
                    <option value="disabled">停用</option>
                  </select>
                </label>
                <label>
                  定價
                  <input
                    type="number"
                    value={product.listPrice}
                    onChange={(event) =>
                      change(product.productKey, {
                        listPrice: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  活動價
                  <input
                    type="number"
                    value={product.salePrice ?? ""}
                    placeholder="未設定"
                    onChange={(event) =>
                      change(product.productKey, {
                        salePrice: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </label>
                <label>
                  天數
                  <input
                    type="number"
                    value={product.accessDays}
                    onChange={(event) =>
                      change(product.productKey, {
                        accessDays: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  免費題數
                  <input
                    type="number"
                    value={product.trialQuestions}
                    onChange={(event) =>
                      change(product.productKey, {
                        trialQuestions: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <button
                disabled={busy === product.productKey}
                onClick={() => void save(product)}
              >
                {busy === product.productKey ? "儲存中…" : "儲存商品設定"}
              </button>
            </article>
          );
        })}
            </div>
            {rows.length > PAGE_SIZE && <nav className="central-pagination" aria-label={`${categoryLabel(category)}商品分頁`}>
              <button disabled={page === 1} onClick={() => setProductPages((current) => ({ ...current, [category]: page - 1 }))}>上一頁</button>
              <span>第 {page}／{Math.ceil(rows.length / PAGE_SIZE)} 頁</span>
              <button disabled={page === Math.ceil(rows.length / PAGE_SIZE)} onClick={() => setProductPages((current) => ({ ...current, [category]: page + 1 }))}>下一頁</button>
            </nav>}
          </details>;
        })}
        {!productGroups.length && <p>目前找不到符合條件的學生商品。</p>}
        </div>
      </section>
    </>
  );
}
