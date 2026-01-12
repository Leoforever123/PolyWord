const API_BASE = "http://localhost:8000";

export async function parseText(text) {
  const res = await fetch(`${API_BASE}/api/parse/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error("parseText failed");
  return res.json();
}

export async function parseFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/parse/file`, {
    method: "POST",
    body: fd
  });
  if (!res.ok) throw new Error("parseFile failed");
  return res.json();
}

export async function getSemanticLinks(words, { topK = 3, threshold = 0.28 } = {}) {
  const res = await fetch(`${API_BASE}/api/semantic-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ words, topK, threshold })
  });
  if (!res.ok) throw new Error("getSemanticLinks failed");
  return res.json();
}
