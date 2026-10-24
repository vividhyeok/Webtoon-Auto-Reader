"use strict";
const cards = document.getElementById("cards"),
  search = document.getElementById("search"),
  series = document.getElementById("series"),
  message = document.getElementById("message");
let revision = 0;
function el(tag, text) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  return e;
}
async function request(type, data) {
  const r = await chrome.runtime.sendMessage({ type, ...data });
  if (!r.ok) throw Error(r.error);
  return r;
}
async function render() {
  const current = ++revision;
  const items = (await chrome.storage.local.get("bookmarks")).bookmarks || [];
  if (current !== revision) return;
  cards.replaceChildren();
  const selected = series.value;
  series.replaceChildren();
  const all = el("option", "모든 작품");
  all.value = "";
  series.append(all);
  for (const [id, title] of new Map(items.map((i) => [i.seriesId, i.title]))) {
    const option = el("option", title);
    option.value = id;
    series.append(option);
  }
  series.value = selected;
  const query = search.value.toLowerCase();
  const matches = items
    .filter((i) => !series.value || i.seriesId === series.value)
    .filter((i) =>
      [i.title, i.episodeTitle, i.tags, i.note]
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
    .sort(
      (a, b) => a.title.localeCompare(b.title) || b.createdAt - a.createdAt,
    );
  message.textContent = matches.length
    ? `${matches.length}개 장면 · 작품별 정렬`
    : "저장한 장면이 없습니다.";
  for (const item of matches) {
    const card = el("article");
    card.append(
      el("h2", item.title + " · " + item.episodeTitle),
      el("p", new Date(item.createdAt).toLocaleString("ko-KR")),
    );
    if (item.hasImage) {
      const data = await SceneDB.run("readonly", item.id);
      if (current !== revision) return;
      if (data) {
        const img = el("img");
        img.loading = "lazy";
        img.src = data;
        img.alt = item.title + " 저장 화면";
        card.append(img);
        const a = el("a", "이미지 파일로 저장");
        a.href = data;
        a.download = `scene-${item.id}.png`;
        card.append(a);
      }
    } else {
      const placeholder = el("div", "☆ 저장한 읽기 위치");
      placeholder.className = "placeholder";
      card.append(placeholder);
    }
    const tags = el("input");
    tags.value = item.tags || "";
    const note = el("textarea");
    note.value = item.note || "";
    note.rows = 3;
    for (const [name, input] of [
      ["태그 (쉼표로 구분)", tags],
      ["메모", note],
    ]) {
      const l = el("label", name);
      l.append(input);
      card.append(l);
    }
    function button(text, type, extra) {
      const b = el("button", text);
      b.onclick = async () => {
        b.disabled = true;
        try {
          await request(type, { id: item.id, ...extra?.() });
          if (type !== "BOOKMARK_OPEN") await render();
        } catch (e) {
          message.textContent = e.message;
        } finally {
          b.disabled = false;
        }
      };
      card.append(b);
    }
    button("이 위치에서 열기", "BOOKMARK_OPEN");
    button("태그 · 메모 저장", "BOOKMARK_EDIT", () => ({
      tags: tags.value,
      note: note.value,
    }));
    if (item.hasImage) button("이미지만 삭제", "IMAGE_DELETE");
    button("장면 삭제", "BOOKMARK_DELETE");
    cards.append(card);
  }
}
series.onchange = () =>
  render().catch((e) => (message.textContent = e.message));
search.oninput = () => render().catch((e) => (message.textContent = e.message));
render().catch((e) => (message.textContent = e.message));
