import * as d3 from "d3";
import cloud from "d3-cloud";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function attachZoom(svgEl, g, onZoomK) {
  const svg = d3.select(svgEl);

  const zoom = d3.zoom()
    .scaleExtent([0.25, 4])
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
      if (onZoomK) onZoomK(event.transform.k);
    });

  svg.call(zoom);
  // 双击默认会 zoom-in，产品里通常关掉
  svg.on("dblclick.zoom", null);

  // 暴露给 main.js 的控制条
  svgEl.__zoomBehavior = zoom;
}

export async function renderSpiral(svgEl, words, opts, onZoomK) {
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  svg.attr("width", opts.w).attr("height", opts.h).attr("viewBox", `0 0 ${opts.w} ${opts.h}`);

  // 根容器：用于 zoom/pan
  const root = svg.append("g");

  attachZoom(svgEl, root, onZoomK);

  const rnd = mulberry32(opts.seed);
  const rotate = () => (rnd() < opts.rotateProb ? 90 : 0);

  return new Promise((resolve) => {
    cloud()
      .size([opts.w, opts.h])
      .words(words.map((d, i) => ({
        text: d.text,
        size: d.size,
        color: d3.schemeTableau10[i % 10]
      })))
      .padding(2)
      .rotate(rotate)
      .font("ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial")
      .fontSize(d => d.size)
      .spiral("archimedean")
      .random(rnd)
      .on("end", (layoutWords) => {
        const g = root.append("g")
          .attr("transform", `translate(${opts.w / 2}, ${opts.h / 2})`);

        g.selectAll("text")
          .data(layoutWords)
          .enter()
          .append("text")
          .style("font-size", d => `${d.size}px`)
          .style("font-family", d => d.font)
          .style("fill", d => d.color)
          .attr("text-anchor", "middle")
          .attr("transform", d => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
          .text(d => d.text);

        resolve();
      })
      .start();
  });
}
