import "./style.css";

import * as d3 from "d3";
import { createIcons, icons } from "lucide";
import { parseText, parseFile, getSemanticLinks } from "./api.js";
import { renderSpiral } from "./renderSpiral.js";
import { renderForce } from "./renderForce.js";

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
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">词云生成器 <span class="text-slate-500 font-normal">（产品风）</span></h1>
        <p class="text-sm md:text-base text-slate-600">FastAPI：解析输入/计算语义边；前端：渲染与交互（zoom/drag/highlight/tooltip）。</p>
      </div>
      <div class="flex items-center gap-2">
        <button id="btnRender" class="px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition text-sm">生成词云</button>
        <button id="btnDownload" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-white transition text-sm">导出SVG</button>
      </div>
    </header>

    <main class="grid grid-cols-1 lg:grid-cols-6 gap-4">
      <section class="lg:col-span-2 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-4 shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <div class="font-semibold">输入与参数</div>
          <div id="status" class="text-xs text-slate-500">就绪</div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="flex items-center gap-2 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
            <input type="radio" name="algo" value="spiral" checked />
            <div>
              <div class="text-sm font-semibold">螺旋线</div>
              <div class="text-xs text-slate-500">d3-cloud</div>
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

        <div class="bg-slate-50 overflow-auto">
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

function setStatus(msg) { statusEl.textContent = msg; }

function getAlgo() {
  return [...document.querySelectorAll("input[name=algo]")].find(x => x.checked)?.value ?? "spiral";
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

    if (algo === "spiral") {
      setStatus("渲染中（螺旋线）...");
      await renderSpiral(svgEl, words, opts, (k) => updateZoomUI(k));
    } else {
      setStatus("请求语义边（后端）...");
      const { links } = await getSemanticLinks(baseWords, { topK: 3, threshold: 0.28 });

      setStatus("渲染中（力导向）...");
      await renderForce(svgEl, words, links, opts, (k) => updateZoomUI(k));
    }

    resetZoom();
    setStatus(`完成：${words.length} 个词`);
  } catch (e) {
    console.error(e);
    setStatus(`错误：${e?.message ?? e}`);
  }
}

function loadExample() {
  const sample = [
    ["机器学习", 98],
    ["深度学习", 92],
    ["自然语言处理", 86],
    ["计算机视觉", 80],
    ["优化", 77],
    ["数值稳定性", 74],
    ["图神经网络", 69],
    ["扩散模型", 67],
    ["Transformer", 65],
    ["语义相似度", 60],
    ["向量检索", 58],
    ["回测", 46],
    ["风险控制", 44],
    ["Web应用", 36],
    ["D3.js", 34],
    ["力导向布局", 30],
    ["螺旋线算法", 28]
  ].map(([w, s]) => `${w},${s}`).join("\n");
  document.querySelector("#textInput").value = sample;
  setStatus("已加载示例（可直接生成）");
}

document.querySelector("#btnRender").addEventListener("click", render);
document.querySelector("#btnDownload").addEventListener("click", () => downloadSVG(svgEl));
document.querySelector("#btnExample").addEventListener("click", loadExample);

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
  el.addEventListener("change", () => render());
}

loadExample();
updateZoomUI(1);
