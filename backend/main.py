"""
词云生成器后端服务

主要功能：
1. 解析用户输入（文本/CSV/XLSX）转换为词表
2. 计算词之间的语义相似边（用于力导向布局）

技术栈：
- FastAPI: Web 框架
- Pandas: 文件解析（CSV/XLSX）
- Sentence-Transformers: 语义向量化（可选，当前使用简化版本）

API 端点：
- POST /api/parse/text: 解析手写文本输入
- POST /api/parse/file: 解析文件（CSV/XLSX）
- POST /api/semantic-links: 计算语义相似边
- GET /api/health: 健康检查
"""

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import io
import math

app = FastAPI(title="WordCloud Backend", version="0.2.0")

# CORS 配置：允许前端跨域访问
# 开发期：允许前端 Vite 开发服务器（5173/5174 都可能出现）
# 生产环境应限制为实际的前端域名
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

# ==================== 数据模型 ====================

class ParseTextIn(BaseModel):
    """解析文本输入的请求模型"""
    text: str  # 多行文本，每行格式：word 或 word,weight

class SemanticLinksIn(BaseModel):
    """计算语义边的请求模型"""
    words: list[dict]           # 词表：[{text: str, weight?: number}, ...]
    topK: int = 3               # 每个词保留前 topK 个最相似的词
    threshold: float = 0.28     # 相似度阈值，低于此值的边会被过滤

# ==================== 工具函数 ====================

def _normalize_df_to_words(df: pd.DataFrame):
    """
    将 DataFrame 转换为标准词表格式
    
    支持的输入格式：
    1. 单列：只有词文本，weight 默认为 1.0
    2. 两列：第一列为词文本，第二列为权重
    
    处理逻辑：
    - 自动去除全空行和全空列
    - 处理缺失值（NaN）
    - 权重解析失败时使用默认值 1.0
    
    Args:
        df: pandas DataFrame，包含词数据
        
    Returns:
        list[dict]: 标准词表格式 [{"text": str, "weight": float}, ...]
    """
    if df is None or df.empty:
        return []

    # 清理：去除全空列和全空行
    df = df.dropna(axis=1, how="all")
    df = df.dropna(axis=0, how="all")
    if df.empty:
        return []

    # 单列格式：只有词文本
    if df.shape[1] == 1:
        col0 = df.columns[0]
        words = []
        for v in df[col0].astype(str).tolist():
            t = v.strip()
            if t:
                words.append({"text": t, "weight": 1.0})
        return words

    # 两列格式：词文本 + 权重
    c0, c1 = df.columns[0], df.columns[1]
    words = []
    for a, b in zip(df[c0].tolist(), df[c1].tolist()):
        if pd.isna(a):
            continue
        text = str(a).strip()
        if not text:
            continue
        # 尝试解析权重，失败则使用默认值 1.0
        try:
            weight = float(b) if not pd.isna(b) else 1.0
        except Exception:
            weight = 1.0
        words.append({"text": text, "weight": weight})
    return words

def _dedup(words):
    """
    去重：合并相同词的多个条目
    
    策略：同词取最大 weight（保留权重最高的）
    
    使用场景：
    - 用户输入可能有重复词
    - 文件解析时可能有重复行
    - 确保每个词只出现一次
    
    Args:
        words: list[dict]，原始词表
        
    Returns:
        list[dict]: 去重后的词表，每个词只出现一次
    """
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
        # 同词取最大 weight
        if (t not in m) or (w > m[t]):
            m[t] = w
    return [{"text": k, "weight": v} for k, v in m.items()]

# ==================== API 端点 ====================

@app.get("/api/health")
def health():
    """
    健康检查端点
    
    用于检查后端服务是否正常运行
    前端可以在启动时调用此接口确认后端可用
    
    Returns:
        dict: {"ok": True}
    """
    return {"ok": True}

@app.post("/api/parse/text")
def parse_text(payload: ParseTextIn):
    """
    解析手写文本输入
    
    支持的输入格式：
    - 每行一个词：word
    - 每行词+权重：word,weight
    
    示例输入：
    ```
    机器学习
    深度学习,92
    自然语言处理,86
    ```
    
    处理流程：
    1. 按行分割文本
    2. 解析每行：如果有逗号，分割为 word,weight；否则 weight=1.0
    3. 去重（同词取最大 weight）
    
    Args:
        payload: ParseTextIn，包含 text 字段
        
    Returns:
        dict: {"words": [{"text": str, "weight": float}, ...]}
    """
    lines = [x.strip() for x in (payload.text or "").splitlines()]
    words = []
    for line in lines:
        if not line:
            continue
        # 检查是否有逗号分隔（word,weight 格式）
        if "," in line:
            a, b = line.split(",", 1)
            t = a.strip()
            if not t:
                continue
            # 解析权重，失败则使用默认值 1.0
            try:
                w = float(b.strip())
            except Exception:
                w = 1.0
            words.append({"text": t, "weight": w})
        else:
            # 只有词文本，权重默认为 1.0
            words.append({"text": line, "weight": 1.0})
    # 去重：同词取最大 weight
    words = _dedup(words)
    return {"words": words}

@app.post("/api/parse/file")
async def parse_file(file: UploadFile = File(...)):
    """
    解析上传的文件（CSV / XLSX）
    
    支持的文件格式：
    - CSV: .csv（自动处理 UTF-8 BOM）
    - Excel: .xlsx, .xls
    
    文件格式要求：
    - 第一列：词文本（必需）
    - 第二列：权重（可选，缺失时默认为 1.0）
    - 列名不严格要求，自动识别前两列
    
    处理流程：
    1. 根据文件扩展名选择解析器
    2. 使用 pandas 读取文件
    3. 转换为标准词表格式
    4. 去重
    
    Args:
        file: UploadFile，上传的文件对象
        
    Returns:
        dict: {"words": [...], "error": str}，成功时 error 为空
    """
    name = (file.filename or "").lower()
    content = await file.read()

    # CSV 文件解析
    if name.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(content))
        except UnicodeDecodeError:
            # 尝试 UTF-8 BOM 编码（Excel 导出的 CSV 常用）
            df = pd.read_csv(io.BytesIO(content), encoding="utf-8-sig")
    # Excel 文件解析
    elif name.endswith(".xlsx") or name.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(content))
    else:
        return {"words": [], "error": "unsupported_file_type"}

    # 转换为标准词表格式并去重
    words = _normalize_df_to_words(df)
    words = _dedup(words)
    return {"words": words}

# ==================== 语义边计算 ====================

def _hash_vector(text: str, dim: int = 16):
    """
    将文本转换为向量（简化版 embedding）
    
    注意：这是一个轻量级的示例实现，用于演示。
    生产环境建议使用：
    - Sentence-BERT（sentence-transformers）
    - OpenAI Embeddings API
    - 其他预训练的语义向量模型
    
    当前实现：
    - 基于字符的哈希特征
    - 使用字符位置和 ASCII 码生成特征
    - L2 归一化
    
    Args:
        text: 输入文本
        dim: 向量维度（默认 16，实际应用建议 384 或 768）
        
    Returns:
        list[float]: 归一化后的向量
    """
    v = [0.0] * dim
    # 基于字符位置和 ASCII 码生成特征
    for i, ch in enumerate(text):
        c = ord(ch)
        # 使用哈希函数将字符映射到向量维度
        idx = (c + i * 131) % dim
        v[idx] += 1.0
    # L2 归一化
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]

def _cosine(a, b):
    """
    计算两个向量的余弦相似度
    
    公式：cos(θ) = (a · b) / (||a|| ||b||)
    
    由于输入向量已归一化（L2 norm = 1），
    余弦相似度 = 点积 = sum(a[i] * b[i])
    
    Args:
        a: list[float]，归一化向量
        b: list[float]，归一化向量
        
    Returns:
        float: 余弦相似度，范围 [-1, 1]（归一化后通常为 [0, 1]）
    """
    return sum(x * y for x, y in zip(a, b))

def compute_links(words: list[str], topK: int = 3, threshold: float = 0.28):
    """
    计算词之间的语义相似边
    
    算法流程：
    1. 将每个词转换为向量（embedding）
    2. 计算所有词对之间的余弦相似度
    3. 对每个词，保留相似度最高的 topK 个邻居
    4. 过滤掉相似度 < threshold 的边
    
    复杂度：O(n²)，n 为词数
    优化建议：
    - 使用近似最近邻（ANN）算法（如 HNSW、FAISS）
    - 缓存 embedding 向量
    - 使用更高效的向量库（numpy）
    
    Args:
        words: list[str]，词列表
        topK: int，每个词保留前 topK 个最相似的词
        threshold: float，相似度阈值，低于此值的边会被过滤
        
    Returns:
        list[dict]: 边列表，格式 [{"source": int, "target": int, "sim": float}, ...]
                    source 和 target 是词在 words 列表中的索引
    """
    # 步骤 1: 将每个词转换为向量
    vecs = [_hash_vector(w, 16) for w in words]
    links = []
    n = len(words)
    
    # 步骤 2-4: 计算相似度并筛选边
    for i in range(n):
        sims = []
        # 计算词 i 与其他所有词的相似度
        for j in range(n):
            if i == j:
                continue
            sim = _cosine(vecs[i], vecs[j])
            sims.append((j, sim))
        
        # 按相似度降序排序，取前 topK 个
        sims.sort(key=lambda x: x[1], reverse=True)
        for (j, sim) in sims[: max(1, topK)]:
            # 只保留相似度 >= threshold 的边
            if sim >= threshold:
                links.append({"source": i, "target": j, "sim": float(sim)})
    
    return links

@app.post("/api/semantic-links")
def semantic_links(payload: SemanticLinksIn):
    """
    计算语义相似边（用于力导向布局）
    
    输入：词表（带权重）
    输出：语义边列表（source/target 使用词索引）
    
    用途：
    - 力导向布局需要知道词之间的语义关系
    - 相似度高的词会被"拉近"，相似度低的词会被"推远"
    - 前端根据相似度设置边的长度和强度
    
    输出格式：
    - source: int，源词索引（在 words 列表中的位置）
    - target: int，目标词索引
    - sim: float，相似度 [0, 1]，越高越相似
    
    注意：
    - 当前使用简化的哈希向量，生产环境建议替换为真实 embedding 模型
    - 可以集成 Sentence-BERT、OpenAI Embeddings 等
    
    Args:
        payload: SemanticLinksIn，包含：
            - words: 词表 [{"text": str, "weight": float}, ...]
            - topK: 每个词保留前 topK 个最相似的词（默认 3）
            - threshold: 相似度阈值（默认 0.28）
            
    Returns:
        dict: {"links": [{"source": int, "target": int, "sim": float}, ...]}
    """
    raw = payload.words or []
    # 提取词文本（忽略权重，语义相似度只依赖文本）
    texts = []
    for d in raw:
        t = str(d.get("text", "")).strip()
        if t:
            texts.append(t)

    # 计算语义边
    links = compute_links(texts, topK=int(payload.topK), threshold=float(payload.threshold))
    return {"links": links}
