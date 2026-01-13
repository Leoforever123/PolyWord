from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import io
import math

app = FastAPI(title="WordCloud Backend", version="0.2.0")

# 开发期：允许前端 Vite 跨域（5173/5174 都可能出现）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ParseTextIn(BaseModel):
    text: str

class SemanticLinksIn(BaseModel):
    words: list[dict]           # [{text, weight?}, ...]
    topK: int = 3
    threshold: float = 0.28

def _normalize_df_to_words(df: pd.DataFrame):
    """
    支持两种常见格式：
    1) 两列：word, weight（列名可不严格）
    2) 一列：word（weight 默认 1）
    """
    if df is None or df.empty:
        return []

    df = df.dropna(axis=1, how="all")
    df = df.dropna(axis=0, how="all")
    if df.empty:
        return []

    if df.shape[1] == 1:
        col0 = df.columns[0]
        words = []
        for v in df[col0].astype(str).tolist():
            t = v.strip()
            if t:
                words.append({"text": t, "weight": 1.0})
        return words

    c0, c1 = df.columns[0], df.columns[1]
    words = []
    for a, b in zip(df[c0].tolist(), df[c1].tolist()):
        if pd.isna(a):
            continue
        text = str(a).strip()
        if not text:
            continue
        try:
            weight = float(b) if not pd.isna(b) else 1.0
        except Exception:
            weight = 1.0
        words.append({"text": text, "weight": weight})
    return words

def _dedup(words):
    # 同词取最大 weight
    m = {}
    for d in words:
        t = str(d.get("text", "")).strip()
        if not t:
            continue
        w = d.get("weight", 1.0)
        try:
            w = float(w)
        except Exception:
            w = 1.0
        if (t not in m) or (w > m[t]):
            m[t] = w
    return [{"text": k, "weight": v} for k, v in m.items()]

@app.get("/api/health")
def health():
    return {"ok": True}

@app.post("/api/parse/text")
def parse_text(payload: ParseTextIn):
    """
    解析手写输入：每行一个词，或 word,weight
    """
    lines = [x.strip() for x in (payload.text or "").splitlines()]
    words = []
    for line in lines:
        if not line:
            continue
        if "," in line:
            a, b = line.split(",", 1)
            t = a.strip()
            if not t:
                continue
            try:
                w = float(b.strip())
            except Exception:
                w = 1.0
            words.append({"text": t, "weight": w})
        else:
            words.append({"text": line, "weight": 1.0})
    words = _dedup(words)
    return {"words": words}

@app.post("/api/parse/file")
async def parse_file(file: UploadFile = File(...)):
    """
    支持 CSV / XLSX
    """
    name = (file.filename or "").lower()
    content = await file.read()

    if name.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(content))
        except UnicodeDecodeError:
            df = pd.read_csv(io.BytesIO(content), encoding="utf-8-sig")
    elif name.endswith(".xlsx") or name.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(content))
    else:
        return {"words": [], "error": "unsupported_file_type"}

    words = _normalize_df_to_words(df)
    words = _dedup(words)
    return {"words": words}

# -------------------------
# 语义边：后端计算（轻量示例）
# -------------------------
def _hash_vector(text: str, dim: int = 16):
    v = [0.0] * dim
    for i, ch in enumerate(text):
        c = ord(ch)
        idx = (c + i * 131) % dim
        v[idx] += 1.0
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]

def _cosine(a, b):
    return sum(x * y for x, y in zip(a, b))

def compute_links(words: list[str], topK: int = 3, threshold: float = 0.28):
    vecs = [_hash_vector(w, 16) for w in words]
    links = []
    n = len(words)
    for i in range(n):
        sims = []
        for j in range(n):
            if i == j:
                continue
            sim = _cosine(vecs[i], vecs[j])
            sims.append((j, sim))
        sims.sort(key=lambda x: x[1], reverse=True)
        for (j, sim) in sims[: max(1, topK)]:
            if sim >= threshold:
                links.append({"source": i, "target": j, "sim": float(sim)})
    return links

@app.post("/api/semantic-links")
def semantic_links(payload: SemanticLinksIn):
    """
    输入 words，输出 links（source/target 用索引）
    后续你可以把 compute_links 换成真实 embedding 的余弦相似度。
    """
    raw = payload.words or []
    texts = []
    for d in raw:
        t = str(d.get("text", "")).strip()
        if t:
            texts.append(t)

    links = compute_links(texts, topK=int(payload.topK), threshold=float(payload.threshold))
    return {"links": links}
