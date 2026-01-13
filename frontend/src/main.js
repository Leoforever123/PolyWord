import "./style.css";

import * as d3 from "d3";
import { createIcons, icons } from "lucide";
import { parseText, parseFile, getSemanticLinks } from "./api.js";
import { renderSpiral } from "./renderSpiral.js";
import { renderForce } from "./renderForce.js";
import { renderSpiralAdvanced } from "./renderSpiralAdvanced.js";

const app = document.querySelector("#app");

function scaleFont(words, minFont, maxFont) {
  const weights = words.map(d => d.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const s = d3.scaleSqrt().domain([minW, maxW]).range([minFont, maxFont]);
  return words.map(d => ({ ...d, size: s(d.weight) }));
}

function downloadSVG(svgEl) {
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svgEl);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wordcloud.svg";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

app.innerHTML = `
  <div class="max-w-7xl mx-auto p-4 md:p-6">
    <header class="flex items-start md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">词云生成器</h1>
      </div>
      <div class="flex items-center gap-2">
        <button id="btnRender" class="px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition text-sm">生成词云</button>
        <button id="btnUnpinAll" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-white transition text-sm">Unpin All</button>
        <button id="btnDownload" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-white transition text-sm">导出SVG</button>
      </div>
    </header>

    <main class="grid grid-cols-1 lg:grid-cols-6 gap-4">
      <section class="lg:col-span-2 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-4 shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <div class="font-semibold">输入与参数</div>
          <div id="status" class="text-xs text-slate-500">就绪</div>
        </div>

        <div class="grid grid-cols-1 gap-2">
          <label class="flex items-center gap-2 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
            <input type="radio" name="algo" value="spiral" checked />
            <div>
              <div class="text-sm font-semibold">螺旋线</div>
              <div class="text-xs text-slate-500">d3-cloud</div>
            </div>
          </label>

          <label class="flex items-center gap-2 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
            <input type="radio" name="algo" value="spiral_advanced" />
            <div>
              <div class="text-sm font-semibold">高级螺旋线（形状词云）</div>
              <div class="text-xs text-slate-500">形状约束 + 像素级精确排布</div>
            </div>
          </label>

          <label class="flex items-center gap-2 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
            <input type="radio" name="algo" value="force" />
            <div>
              <div class="text-sm font-semibold">力导向</div>
              <div class="text-xs text-slate-500">语义边 + 碰撞防重叠</div>
            </div>
          </label>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-slate-700">宽</label>
            <input id="w" type="number" value="1100" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </div>
          <div>
            <label class="text-sm font-medium text-slate-700">高</label>
            <input id="h" type="number" value="700" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-slate-700">最小字号</label>
            <input id="minFont" type="number" value="14" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </div>
          <div>
            <label class="text-sm font-medium text-slate-700">最大字号</label>
            <input id="maxFont" type="number" value="78" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-slate-700">旋转概率</label>
            <input id="rotateProb" type="number" step="0.05" value="0.25" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </div>
          <div>
            <label class="text-sm font-medium text-slate-700">种子</label>
            <input id="seed" type="number" value="42" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </div>
        </div>

        <!-- Advanced spiral options -->
        <div id="advancedPanel" class="pt-2 border-t border-slate-200 space-y-3 hidden">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-slate-700">高级螺旋线（形状词云）</div>
            <span class="text-xs text-slate-500">自适应画布</span>
          </div>

          <div class="space-y-2">
            <div class="text-sm text-slate-700">形状来源</div>
            <div class="grid grid-cols-2 gap-2">
              <label class="flex items-center gap-2 p-2 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
                <input type="radio" name="shapeSource" value="builtin" checked />
                <span class="text-sm">内置</span>
              </label>
              <label class="flex items-center gap-2 p-2 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
                <input type="radio" name="shapeSource" value="image" />
                <span class="text-sm">上传PNG</span>
              </label>
            </div>
          </div>

          <div id="builtinShapeRow" class="space-y-2">
            <label class="text-sm font-medium text-slate-700">内置形状</label>
            <select id="builtinShape" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200">
              <option value="circle" selected>circle</option>
              <option value="heart">heart</option>
              <option value="roundedRect">roundedRect</option>
              <option value="star">star</option>
            </select>
          </div>

          <div id="imageShapeRow" class="space-y-2 hidden">
            <label class="text-sm font-medium text-slate-700">上传形状 PNG（mask）</label>
            <input id="maskInput" type="file" accept="image/png,image/jpeg,image/webp" class="block w-full text-sm" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-sm font-medium text-slate-700">边界留白 shapePadding</label>
              <input id="shapePadding" type="number" value="0" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <p class="text-xs text-slate-500">正数：更收缩更留白；负数：更贴边（0=紧密）</p>
            </div>
            <div>
              <label class="text-sm font-medium text-slate-700">词间距 wordPadding</label>
              <input id="wordPadding" type="number" value="1" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <p class="text-xs text-slate-500">越小越紧密（0~1 推荐，0=像素级紧密）</p>
            </div>
          </div>

          <label class="flex items-center justify-between gap-3">
            <span class="text-sm text-slate-700">debug：显示 mask 采样点</span>
            <input id="debugMask" type="checkbox" class="h-4 w-4" />
          </label>

          <div class="pt-2 border-t border-slate-200 space-y-2">
            <div class="text-sm font-medium text-slate-700">自适应调整（优先填满形状）</div>
            <label class="flex items-center justify-between gap-3">
              <span class="text-sm text-slate-700">启用自适应字号</span>
              <input id="enableAdaptive" type="checkbox" checked class="h-4 w-4" />
            </label>
            <div>
              <label class="text-sm font-medium text-slate-700">目标覆盖率（%）</label>
              <input id="targetCoverage" type="number" value="85" min="60" max="95" step="5" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <p class="text-xs text-slate-500">越高越填满形状（推荐 80-90%，参考图效果）</p>
            </div>
            <div>
              <label class="text-sm font-medium text-slate-700">非线性压缩（0.3-1.0）</label>
              <input id="nonlinearPower" type="number" value="0.5" min="0.3" max="1.0" step="0.1" class="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <p class="text-xs text-slate-500">越小越压缩字号差异（0.5=强压缩，1.0=保持比例）</p>
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-slate-700">手写词表（每行 word 或 word,weight）</label>
            <button id="btnExample" class="text-xs px-2 py-1 rounded-lg border border-slate-200 hover:bg-white">加载示例</button>
          </div>
          <textarea id="textInput" rows="8" class="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"></textarea>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-slate-700">上传 CSV / XLSX</label>
          <input id="fileInput" type="file" accept=".csv,.xlsx,.xls" class="block w-full text-sm" />
          <p class="text-xs text-slate-500">CSV/XLSX：推荐两列（word, weight）或一列（word）。</p>
        </div>

        <div class="pt-2 border-t border-slate-200 space-y-3">
          <div class="text-sm font-medium text-slate-700">图层与高亮</div>

          <label class="flex items-center justify-between gap-3">
            <span class="text-sm text-slate-700">显示连线</span>
            <input id="showLinks" type="checkbox" checked class="h-4 w-4" />
          </label>

          <label class="flex items-center justify-between gap-3">
            <span class="text-sm text-slate-700">显示 Tooltip</span>
            <input id="showTooltip" type="checkbox" checked class="h-4 w-4" />
          </label>

          <div class="space-y-1">
            <div class="text-sm text-slate-700">高亮范围</div>
            <div class="grid grid-cols-2 gap-2">
              <label class="flex items-center gap-2 p-2 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
                <input type="radio" name="highlightHop" value="1" checked />
                <span class="text-sm">1-hop</span>
              </label>
              <label class="flex items-center gap-2 p-2 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
                <input type="radio" name="highlightHop" value="2" />
                <span class="text-sm">2-hop</span>
              </label>
            </div>
            <p class="text-xs text-slate-500">hover 预览 + click 锁定；连线按 sim 强度高亮。</p>
          </div>
        </div>

        <div class="pt-2 border-t border-slate-200 space-y-2">
          <div class="text-sm font-medium text-slate-700">预览缩放</div>
          <div class="flex items-center gap-2">
            <button id="zoomOut" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-white text-sm">-</button>
            <button id="zoomReset" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-white text-sm">重置</button>
            <button id="zoomIn" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-white text-sm">+</button>
          </div>
          <div class="flex items-center gap-3">
            <input id="zoomSlider" type="range" min="0.25" max="4" value="1" step="0.05" class="w-full" />
            <span id="zoomLabel" class="text-xs text-slate-500 w-14 text-right">100%</span>
          </div>
          <p class="text-xs text-slate-500">提示：也可在预览区滚轮缩放、按住拖动画布。</p>
        </div>
      </section>

      <section class="lg:col-span-4 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div class="font-semibold">预览</div>
          <div class="text-xs text-slate-500">滚轮缩放 / 拖拽平移；力导向词可拖拽；hover/click 高亮</div>
        </div>

        <div class="bg-slate-50 overflow-auto h-full">
          <svg id="stage" class="block"></svg>
        </div>
      </section>
    </main>
  </div>
`;

createIcons({ icons });

const statusEl = document.querySelector("#status");
const svgEl = document.querySelector("#stage");
const zoomSlider = document.querySelector("#zoomSlider");
const zoomLabel = document.querySelector("#zoomLabel");

const advancedPanelEl = document.querySelector("#advancedPanel");
const builtinShapeRowEl = document.querySelector("#builtinShapeRow");
const imageShapeRowEl = document.querySelector("#imageShapeRow");

function setStatus(msg) { statusEl.textContent = msg; }

function getAlgo() {
  return [...document.querySelectorAll("input[name=algo]")].find(x => x.checked)?.value ?? "spiral";
}

function getShapeSource() {
  return [...document.querySelectorAll("input[name=shapeSource]")].find(x => x.checked)?.value ?? "builtin";
}

function getOpts() {
  const hop = Number([...document.querySelectorAll("input[name=highlightHop]")].find(x => x.checked)?.value ?? 1);

  return {
    w: Number(document.querySelector("#w").value) || 1100,
    h: Number(document.querySelector("#h").value) || 700,
    minFont: Number(document.querySelector("#minFont").value) || 14,
    maxFont: Number(document.querySelector("#maxFont").value) || 78,
    rotateProb: Math.max(0, Math.min(1, Number(document.querySelector("#rotateProb").value) || 0)),
    seed: Number(document.querySelector("#seed").value) || 42,

    // Advanced spiral options
    advanced: {
      shapeSource: getShapeSource(), // "builtin" | "image"
      builtinShape: document.querySelector("#builtinShape")?.value || "circle",
      shapePadding: Number(document.querySelector("#shapePadding")?.value ?? 0) || 0,
      wordPadding: Number(document.querySelector("#wordPadding")?.value ?? 1) || 1,
      debugMask: !!document.querySelector("#debugMask")?.checked,
      maskFile: document.querySelector("#maskInput")?.files?.[0] || null,
      enableAdaptive: !!document.querySelector("#enableAdaptive")?.checked,
      targetCoverage: Number(document.querySelector("#targetCoverage")?.value ?? 85) / 100,
      nonlinearPower: Number(document.querySelector("#nonlinearPower")?.value ?? 0.5),
    },

    ui: {
      showLinks: !!document.querySelector("#showLinks").checked,
      showTooltip: !!document.querySelector("#showTooltip").checked,
      highlightHop: (hop === 2 ? 2 : 1),
    }
  };
}

function updateZoomUI(k) {
  const kk = Math.max(0.25, Math.min(4, k));
  zoomSlider.value = String(kk);
  zoomLabel.textContent = `${Math.round(kk * 100)}%`;
}

function getZoom() {
  return svgEl.__zoomBehavior;
}

function applyZoomTo(k) {
  const zoom = getZoom();
  if (!zoom) return;
  const svg = d3.select(svgEl);
  svg.transition().duration(120).call(zoom.scaleTo, k);
  updateZoomUI(k);
}

function resetZoom() {
  const zoom = getZoom();
  if (!zoom) return;
  const svg = d3.select(svgEl);
  svg.transition().duration(150).call(zoom.transform, d3.zoomIdentity);
  updateZoomUI(1);
}

async function loadFromText() {
  const text = document.querySelector("#textInput").value || "";
  const { words } = await parseText(text);
  return words;
}

async function loadFromFile(file) {
  const { words, error } = await parseFile(file);
  if (error) throw new Error(error);
  return words;
}

function syncAdvancedPanelVisibility() {
  const algo = getAlgo();
  const show = (algo === "spiral_advanced");
  advancedPanelEl.classList.toggle("hidden", !show);

  const src = getShapeSource();
  builtinShapeRowEl.classList.toggle("hidden", src !== "builtin");
  imageShapeRowEl.classList.toggle("hidden", src !== "image");
}

/**
 * 主渲染函数：根据选择的算法渲染词云
 * 
 * 支持的算法：
 * 1. spiral: 基础螺旋线词云（d3-cloud）
 * 2. spiral_advanced: 高级螺旋线词云（形状约束 + 像素级放置）
 * 3. force: 力导向布局（语义关系图）
 * 
 * 流程：
 * 1. 获取用户输入（文本或文件）
 * 2. 解析为词表 [{text, weight}]
 * 3. 根据权重映射字号
 * 4. 调用对应的渲染器
 * 5. 更新状态信息
 */
async function render() {
  try {
    setStatus("处理中...");
    const opts = getOpts();
    const algo = getAlgo();

    const file = document.querySelector("#fileInput").files?.[0];
    let baseWords = [];
    if (file) baseWords = await loadFromFile(file);
    else baseWords = await loadFromText();

    if (!baseWords.length) {
      setStatus("无词数据（请手写或上传文件）");
      return;
    }

    const words = scaleFont(baseWords, opts.minFont, opts.maxFont);

    if (!svgEl.hasAttribute("width") || svgEl.getAttribute("width") === "0") {
      const container = svgEl.parentElement;
      if (container) {
        const containerW = container.clientWidth || opts.w || 1100;
        const containerH = container.clientHeight || opts.h || 700;
        svgEl.setAttribute("width", containerW);
        svgEl.setAttribute("height", containerH);
      }
    }

    if (algo === "spiral") {
      setStatus("渲染中（螺旋线）...");
      await renderSpiral(svgEl, words, opts, (k) => updateZoomUI(k));
    } else if (algo === "spiral_advanced") {
      setStatus("渲染中（高级螺旋线 / 形状词云）...");

      const adv = opts.advanced;

      // Build shape options for renderSpiralAdvanced
      let shape;
      if (adv.shapeSource === "image") {
        if (!adv.maskFile) {
          setStatus("请选择一个 PNG/JPG/WebP 作为形状 mask（高级螺旋线）");
          return;
        }
        shape = {
          type: "image",
          source: adv.maskFile,
          mode: "alpha",
          shapePadding: Math.floor(adv.shapePadding || 0),
          alphaThreshold: 1,
        };
      } else {
        shape = {
          type: "builtin",
          name: adv.builtinShape || "circle",
          margin: 8,
          shapePadding: Math.floor(adv.shapePadding || 0),
        };
      }

      await renderSpiralAdvanced(svgEl, words, {
        // 注意：高级模式自适应容器尺寸，这里不强依赖 opts.w/opts.h
        shape,
        wordPadding: Math.max(0, Math.floor(adv.wordPadding ?? 1)),
        rotate: 0, // 你要全横向；先固定为 0（后续如需支持旋转再加）
        debugMask: !!adv.debugMask,
        adaptiveFontSize: adv.enableAdaptive !== false,
        targetCoverage: adv.targetCoverage ?? 0.55,
        nonlinearPower: adv.nonlinearPower ?? 0.7,
      }, (k) => updateZoomUI(k));
    } else {
      /**
       * 力导向布局：限制词数量以避免性能问题
       * 
       * 原因：
       * - 词数太多迭代慢，会出现重叠问题
       */
      const maxForceWords = 15;
      const forceWords = words.slice(0, maxForceWords);
      
      setStatus(`请求语义边（后端，${forceWords.length}个词）...`);
      const { links } = await getSemanticLinks(
        baseWords.slice(0, maxForceWords), 
        { topK: 3, threshold: 0.28 }
      );

      setStatus("渲染中（力导向）...");
      await renderForce(svgEl, forceWords, links, opts, (k) => updateZoomUI(k));
    }

    resetZoom();
    const finalWordCount = algo === "force" ? Math.min(words.length, 15) : words.length;
    const wordCountMsg = algo === "force" && words.length > 15 
      ? `${finalWordCount} 个词（已限制，原始${words.length}个）`
      : `${finalWordCount} 个词`;
    setStatus(`完成：${wordCountMsg}`);
  } catch (e) {
    console.error(e);
    setStatus(`错误：${e?.message ?? e}`);
  }
}

function loadExample() {
  const sample = [
    // Core ML/DL concepts (high weight)
    ["Machine Learning", 98],
    ["Deep Learning", 92],
    ["Neural Networks", 89],
    ["Natural Language Processing", 86],
    ["Computer Vision", 80],
    ["Reinforcement Learning", 79],
    ["Optimization", 77],
    ["Gradient Descent", 76],
    ["Backpropagation", 75],
    ["Numerical Stability", 74],
    ["Convolutional Neural Networks", 73],
    ["Recurrent Neural Networks", 72],
    ["Attention Mechanism", 71],
    ["Graph Neural Networks", 69],
    ["Diffusion Models", 67],
    ["Transformer", 65],
    ["BERT", 64],
    ["GPT", 63],
    ["Semantic Similarity", 60],
    ["Vector Retrieval", 58],
    ["Embeddings", 57],
    ["Feature Engineering", 56],
    ["Hyperparameter Tuning", 55],
    ["Model Training", 54],
    ["Overfitting", 53],
    ["Regularization", 52],
    ["Dropout", 51],
    ["Batch Normalization", 50],
    
    // Applications & Domains (medium-high weight)
    ["Backtesting", 46],
    ["Risk Control", 44],
    ["Time Series Analysis", 43],
    ["Anomaly Detection", 42],
    ["Recommendation Systems", 41],
    ["Sentiment Analysis", 40],
    ["Image Classification", 39],
    ["Object Detection", 38],
    ["Web Application", 36],
    ["Data Visualization", 35],
    ["D3.js", 34],
    ["Interactive Dashboards", 33],
    ["Real-time Processing", 32],
    ["Distributed Systems", 31],
    ["Force-directed Layout", 30],
    ["Spiral Algorithm", 28],
    
    // Technical Implementation (medium weight)
    ["TensorFlow", 48],
    ["PyTorch", 47],
    ["Scikit-learn", 45],
    ["Pandas", 37],
    ["NumPy", 29],
    ["Data Preprocessing", 27],
    ["Feature Selection", 26],
    ["Cross Validation", 25],
    ["Ensemble Methods", 24],
    ["Random Forest", 23],
    ["Support Vector Machines", 22],
    ["Clustering", 21],
    ["Dimensionality Reduction", 20],
    ["Principal Component Analysis", 19],
    ["K-means", 18],
    
    // Advanced Topics (medium-low weight)
    ["Transfer Learning", 17],
    ["Few-shot Learning", 16],
    ["Meta Learning", 15],
    ["Adversarial Training", 14],
    ["Generative Adversarial Networks", 13],
    ["Variational Autoencoders", 12],
    ["Self-supervised Learning", 11],
    ["Multi-task Learning", 10],
    ["Federated Learning", 9],
    ["Neural Architecture Search", 8],
    ["AutoML", 7],
    ["Explainable AI", 6],
    ["Fairness", 5],
    ["Bias Detection", 4],
    ["Model Interpretability", 3],
    
    // Infrastructure & Tools (low weight)
    ["GPU Acceleration", 2],
    ["CUDA", 1],
    ["Distributed Training", 1],
    ["Model Serving", 1],
    ["MLOps", 1],
    ["Data Pipeline", 1],
    ["Feature Store", 1],
    ["Model Registry", 1],
    ["A/B Testing", 1],
    ["Monitoring", 1],
  ].map(([w, s]) => `${w},${s}`).join("\n");
  document.querySelector("#textInput").value = sample;
  setStatus("已加载示例（可直接生成）");
}

// Wire events
document.querySelector("#btnRender").addEventListener("click", render);
document.querySelector("#btnDownload").addEventListener("click", () => downloadSVG(svgEl));
document.querySelector("#btnExample").addEventListener("click", loadExample);

// ✅ Unpin All: renderForce 会挂载 svgEl.__unpinAll
document.querySelector("#btnUnpinAll").addEventListener("click", () => {
  svgEl.__unpinAll?.();
});

// Zoom controls
document.querySelector("#zoomIn").addEventListener("click", () => {
  const k = Number(zoomSlider.value || 1);
  applyZoomTo(Math.min(4, k + 0.2));
});
document.querySelector("#zoomOut").addEventListener("click", () => {
  const k = Number(zoomSlider.value || 1);
  applyZoomTo(Math.max(0.25, k - 0.2));
});
document.querySelector("#zoomReset").addEventListener("click", resetZoom);
zoomSlider.addEventListener("input", (e) => {
  const k = Number(e.target.value || 1);
  applyZoomTo(k);
});

// UI toggles：切换即重新渲染（实现简单、稳定）
for (const sel of ["#showLinks", "#showTooltip"]) {
  document.querySelector(sel).addEventListener("change", () => render());
}
for (const el of document.querySelectorAll("input[name=highlightHop]")) {
  el.addEventListener("change", () => render());
}
for (const el of document.querySelectorAll("input[name=algo]")) {
  el.addEventListener("change", () => {
    syncAdvancedPanelVisibility();
    render();
  });
}

// Advanced panel controls
for (const el of document.querySelectorAll("input[name=shapeSource]")) {
  el.addEventListener("change", () => {
    syncAdvancedPanelVisibility();
    render();
  });
}
for (const sel of ["#builtinShape", "#shapePadding", "#wordPadding", "#debugMask", "#maskInput", "#enableAdaptive", "#targetCoverage", "#nonlinearPower"]) {
  const el = document.querySelector(sel);
  if (!el) continue;
  el.addEventListener("change", () => render());
}

loadExample();
syncAdvancedPanelVisibility();
updateZoomUI(1);