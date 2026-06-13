const state = {
  agency: "Todos",
  year: "Todos",
  query: "",
  selectedCode: null,
  activeAxis: null,
  activeTab: "overview",
};

const els = {
  stateTotal: document.querySelector("#stateTotal"),
  stateSubtitle: document.querySelector("#stateSubtitle"),
  stateSummary: document.querySelector("#stateSummary"),
  agencyFilter: document.querySelector("#agencyFilter"),
  yearFilter: document.querySelector("#yearFilter"),
  searchInput: document.querySelector("#searchInput"),
  filterToggle: document.querySelector("#filterToggle"),
  resetFilters: document.querySelector("#resetFilters"),
  mapStatus: document.querySelector("#mapStatus"),
  mapSvg: document.querySelector("#mapSvg"),
  legend: document.querySelector("#legend"),
  tooltip: document.querySelector("#tooltip"),
  globalAxisStrip: document.querySelector("#globalAxisStrip"),
  overviewView: document.querySelector("#overviewView"),
  axesView: document.querySelector("#axesView"),
  reportView: document.querySelector("#reportView"),
  tabButtons: document.querySelectorAll(".tab-button"),
  exportPdfButton: document.querySelector("#exportPdfButton"),
  emailShareButton: document.querySelector("#emailShareButton"),
  whatsappShareButton: document.querySelector("#whatsappShareButton"),
  installAppButton: document.querySelector("#installAppButton"),
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const compactCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const numberFmt = new Intl.NumberFormat("pt-BR");
const percentFmt = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

const axisColors = {
  "Infraestrutura e Mobilidade": "#20c7f4",
  Educação: "#6658ff",
  Saúde: "#ef5b6c",
  "Agro e Desenvolvimento": "#12a875",
};

let data;
let geojson;
let mapPaths = new Map();
let deferredInstallPrompt = null;

init().catch((error) => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<pre style="position:fixed;z-index:9999;left:12px;right:12px;bottom:12px;max-height:40vh;overflow:auto;background:#2b1110;color:#fff;padding:16px;border-radius:8px;white-space:pre-wrap;">${escapeHtml(error.stack || error.message || error)}</pre>`,
  );
  console.error(error);
});

async function init() {
  const cacheKey = new URLSearchParams(window.location.search).get("v") || String(Date.now());
  [data, geojson] = await Promise.all([
    fetch(`./data/bi-data.json?v=${cacheKey}`, { cache: "no-store" }).then((response) => response.json()),
    fetch(`./data/rondonia-municipios.geojson?v=${cacheKey}`, { cache: "no-store" }).then((response) => response.json()),
  ]);

  const firstMunicipality = [...data.municipalities].sort((a, b) => b.total - a.total)[0];
  state.selectedCode = firstMunicipality?.code;
  state.activeAxis = firstMunicipality?.axes?.[0]?.axis || data.axes?.[0]?.axis;
  state.activeTab = "overview";

  hydrateControls();
  drawMap();
  bindEvents();
  render();
  queueMicrotask(() => {
    state.activeTab = "overview";
    renderTabs();
  });
}

function hydrateControls() {
  els.stateTotal.textContent = compactCurrency.format(data.kpis.totalValue);
  els.stateSubtitle.textContent = `${numberFmt.format(data.kpis.records)} registros, ${data.kpis.agencies} órgãos e ${data.kpis.municipalities} municípios.`;

  const agencyOptions = ["Todos", ...data.agencies.map((item) => item.agency)];
  els.agencyFilter.innerHTML = agencyOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");

  const yearOptions = ["Todos", ...data.years.map((item) => item.year)];
  els.yearFilter.innerHTML = yearOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
}

function bindEvents() {
  els.agencyFilter.addEventListener("change", (event) => {
    state.agency = event.target.value;
    render();
  });

  els.yearFilter.addEventListener("change", (event) => {
    state.year = event.target.value;
    render();
  });

  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  els.filterToggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("filters-open");
    els.filterToggle.setAttribute("aria-expanded", String(isOpen));
  });

  els.resetFilters.addEventListener("click", () => {
    state.agency = "Todos";
    state.year = "Todos";
    state.query = "";
    els.agencyFilter.value = "Todos";
    els.yearFilter.value = "Todos";
    els.searchInput.value = "";
    document.body.classList.remove("filters-open");
    els.filterToggle.setAttribute("aria-expanded", "false");
    render();
  });

  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      renderTabs();
    });
  });

  els.exportPdfButton.addEventListener("click", exportCurrentReport);
  els.emailShareButton.addEventListener("click", shareByEmail);
  els.whatsappShareButton.addEventListener("click", shareByWhatsApp);
  els.installAppButton.addEventListener("click", installApp);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
}

function render() {
  const records = filteredRecords();
  const ranked = getRankedMunicipalities(records);
  if (!records.some((record) => record.code === state.selectedCode) && ranked[0]) {
    state.selectedCode = ranked[0].code;
  }

  const profile = getMunicipalityProfile(state.selectedCode, records);
  if (profile?.axes?.length && !profile.axes.some((axis) => axis.axis === state.activeAxis)) {
    state.activeAxis = profile.axes[0].axis;
  }

  const totals = totalsByMunicipality(records);
  const maxTotal = Math.max(...Object.values(totals), 0);

  renderMap(totals, maxTotal);
  renderLegend(maxTotal);
  renderStatus(records);
  renderStateSummary(records, ranked);
  renderGlobalAxes(records);
  renderOverview(profile, records);
  renderAxes(profile);
  renderReport(profile);
  renderTabs();
}

function filteredRecords() {
  return data.records.filter((record) => {
    const matchesAgency = state.agency === "Todos" || record.agency === state.agency;
    const recordYear = record.year === null ? "Sem ano informado" : String(record.year);
    const matchesYear = state.year === "Todos" || recordYear === state.year;
    const query = state.query;
    const matchesQuery =
      !query ||
      record.municipality.toLowerCase().includes(query) ||
      record.action.toLowerCase().includes(query) ||
      record.agency.toLowerCase().includes(query) ||
      record.axis.toLowerCase().includes(query);
    return matchesAgency && matchesYear && matchesQuery;
  });
}

function drawMap() {
  const width = 920;
  const height = 620;
  const padding = 22;
  const coords = geojson.features.flatMap((feature) => collectCoordinates(feature.geometry.coordinates));
  const xs = coords.map((point) => point[0]);
  const ys = coords.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const mapWidth = (maxX - minX) * scale;
  const mapHeight = (maxY - minY) * scale;
  const offsetX = (width - mapWidth) / 2;
  const offsetY = (height - mapHeight) / 2;
  const project = ([lon, lat]) => [offsetX + (lon - minX) * scale, offsetY + (maxY - lat) * scale];

  els.mapSvg.innerHTML = geojson.features
    .map((feature) => {
      const code = feature.properties.id;
      const name = feature.properties.name;
      return `<path class="municipality" data-code="${code}" data-name="${escapeHtml(name)}" d="${geometryPath(feature.geometry, project)}"></path>`;
    })
    .join("");

  mapPaths = new Map([...els.mapSvg.querySelectorAll(".municipality")].map((path) => [path.dataset.code, path]));
  mapPaths.forEach((path, code) => {
    path.addEventListener("click", () => {
      state.selectedCode = code;
      const profile = getMunicipalityProfile(code, filteredRecords());
      state.activeAxis = profile?.axes?.[0]?.axis || state.activeAxis;
      state.activeTab = "overview";
      render();
    });
    path.addEventListener("mousemove", (event) => showTooltip(event, code));
    path.addEventListener("mouseleave", () => {
      els.tooltip.hidden = true;
    });
  });
}

function renderMap(totals, maxTotal) {
  mapPaths.forEach((path, code) => {
    const value = totals[code] || 0;
    path.setAttribute("fill", mapColor(value, maxTotal));
    path.classList.toggle("is-selected", code === state.selectedCode);
    path.classList.toggle("is-dimmed", Boolean(state.selectedCode) && code !== state.selectedCode);
    path.setAttribute("aria-label", `${path.dataset.name}: ${currency.format(value)}`);
  });
}

function renderLegend(maxTotal) {
  els.legend.innerHTML = `
    <span>${currency.format(0)}</span>
    <span class="legend-bar"></span>
    <span>${compactCurrency.format(maxTotal || 0)}</span>
  `;
}

function renderStatus(records) {
  const chunks = [];
  if (state.agency !== "Todos") chunks.push(state.agency);
  if (state.year !== "Todos") chunks.push(state.year);
  if (state.query) chunks.push(`"${state.query}"`);
  els.mapStatus.textContent = chunks.length
    ? `${numberFmt.format(records.length)} registros | ${chunks.join(" | ")}`
    : "Todos os registros";
}

function renderStateSummary(records, ranked) {
  if (!els.stateSummary) return;

  const total = sum(records, "value");
  const activeMunicipalities = ranked.filter((item) => item.total > 0);
  const top = activeMunicipalities[0];
  const topShare = total && top ? top.total / total : 0;

  const axes = groupBy(records, "axis")
    .map(([axis, items]) => ({ axis, total: sum(items, "value") }))
    .sort((a, b) => b.total - a.total);
  const leadAxis = axes[0];
  const leadAxisShare = total && leadAxis ? leadAxis.total / total : 0;

  const agencies = groupBy(records, "agency")
    .map(([agency, items]) => ({ agency, total: sum(items, "value") }))
    .sort((a, b) => b.total - a.total);
  const leadAgency = agencies[0];

  const recorte =
    state.agency === "Todos" && state.year === "Todos" && !state.query
      ? "no recorte estadual completo"
      : "no recorte filtrado";

  const concentracaoLabel =
    topShare >= 0.25 ? "forte concentração" : topShare >= 0.12 ? "concentração moderada" : "distribuição pulverizada";

  if (!total || !top) {
    els.stateSummary.innerHTML = `<p class="state-narrative">Nenhum registro para os filtros atuais.</p>`;
    return;
  }

  els.stateSummary.innerHTML = `
    <span class="eyebrow">Panorama estadual</span>
    <p class="state-narrative">
      ${recorte.charAt(0).toUpperCase() + recorte.slice(1)}, <strong>${currency.format(total)}</strong> alcançam
      <strong>${activeMunicipalities.length}</strong> municípios, com <strong>${escapeHtml(concentracaoLabel)}</strong>:
      <strong>${escapeHtml(top.name)}</strong> lidera com ${percentFmt.format(topShare)} do total.
      O eixo predominante é <strong>${escapeHtml(leadAxis?.axis || "-")}</strong> (${percentFmt.format(leadAxisShare)})
      e o órgão de maior volume é <strong>${escapeHtml(leadAgency?.agency || "-")}</strong>.
    </p>
    <div class="state-chips">
      ${insightChip("Município líder", `${escapeHtml(top.name)} · ${compactCurrency.format(top.total)}`)}
      ${insightChip("Eixo predominante", `${escapeHtml(leadAxis?.axis || "-")}`)}
      ${insightChip("Órgão líder", `${escapeHtml(leadAgency?.agency || "-")}`)}
    </div>
  `;
}

function renderGlobalAxes(records) {
  const grouped = groupBy(records, "axis")
    .map(([axis, items]) => ({ axis, total: sum(items, "value"), records: items.length }))
    .sort((a, b) => b.total - a.total);
  const total = sum(grouped, "total");

  els.globalAxisStrip.innerHTML = grouped
    .map((item) => {
      const share = total ? item.total / total : 0;
      return `
        <article class="axis-mini-card">
          <span>${escapeHtml(item.axis)}</span>
          <strong>${compactCurrency.format(item.total)}</strong>
          <div class="progress-track"><div class="progress-fill" style="width:${share * 100}%;background:${axisColors[item.axis] || "#20c7f4"}"></div></div>
        </article>
      `;
    })
    .join("");
}

function renderOverview(profile, records) {
  if (!profile) {
    els.overviewView.innerHTML = `<div class="empty-state">Nenhum município encontrado para os filtros atuais.</div>`;
    return;
  }

  const ind = profile.indicators || {};
  const firjan = ind.firjan;

  els.overviewView.innerHTML = `
    <div class="municipality-title">
      <div>
        <span class="eyebrow">Município selecionado</span>
        <h3>${escapeHtml(profile.name)}</h3>
      </div>
      <span class="rank-chip">#${profile.rank} investimento</span>
    </div>

    ${executiveBrief(profile, records)}

    <div class="info-grid">
      ${infoCard("Investimento", compactCurrency.format(profile.total), `${numberFmt.format(profile.records)} registros`, true)}
      ${infoCard("Invest. per capita", valueOrDash(ind.investmentPerCapita, (v) => currency.format(v)), "planilha / população IBGE")}
      ${infoCard("População", valueOrDash(ind.population, numberFmt.format), `IBGE ${ind.populationYear || ""}`)}
      ${infoCard("PIB", valueOrDash(ind.pib, compactCurrency.format), `IBGE ${ind.pibYear || ""}`)}
      ${infoCard("Part. no PIB RO", valueOrDash(ind.pibStateShare, (v) => `${v.toFixed(2).replace(".", ",")}%`), "IBGE/SIDRA")}
      ${infoCard("Invest. / PIB", valueOrDash(ind.investmentToPib, percentFmt.format), "indicador calculado")}
    </div>

    <div class="section-label">Desenvolvimento FIRJAN</div>
    ${
      firjan
        ? `<section class="ifdm-card">
            <div class="ifdm-head">
              <div>
                <span>IFDM Geral</span>
                <strong>${firjan.ifdm.toFixed(4).replace(".", ",")}</strong>
              </div>
              <span class="ifdm-pill">#${firjan.rankState} em RO</span>
            </div>
            <div class="ifdm-bars">
              ${metricRow("Educação", firjan.education)}
              ${metricRow("Saúde", firjan.health)}
              ${metricRow("Emprego", firjan.employmentIncome)}
            </div>
          </section>`
        : `<div class="empty-state">IFDM não localizado para este município.</div>`
    }
  `;
}

function renderAxes(profile) {
  if (!profile) {
    els.axesView.innerHTML = `<div class="empty-state">Selecione um município no mapa.</div>`;
    return;
  }

  els.axesView.innerHTML = `
    <div class="municipality-title">
      <div>
        <span class="eyebrow">Desdobramento</span>
        <h3>${escapeHtml(profile.name)}</h3>
      </div>
    </div>
    <div class="axis-list">
      ${profile.axes.map((axis) => axisCard(axis, profile.total)).join("")}
    </div>
  `;

  els.axesView.querySelectorAll("[data-axis]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeAxis = button.dataset.axis;
      state.activeTab = "report";
      renderReport(profile);
      renderTabs();
    });
  });
}

function axisCard(axis, total) {
  const share = total ? axis.total / total : 0;
  return `
    <button class="axis-card ${axis.axis === state.activeAxis ? "is-active" : ""}" type="button" data-axis="${escapeHtml(axis.axis)}">
      <header>
        <h4>${escapeHtml(axis.axis)}</h4>
        <span class="axis-meta">${numberFmt.format(axis.records)} registros</span>
      </header>
      <div class="axis-value">${compactCurrency.format(axis.total)}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${share * 100}%;background:${axisColors[axis.axis] || "#20c7f4"}"></div></div>
      <span class="axis-meta">${percentFmt.format(share)} do investimento do município. Toque para abrir o relatório.</span>
    </button>
  `;
}

function renderReport(profile) {
  if (!profile) {
    els.reportView.innerHTML = `<div class="empty-state">Sem relatório para os filtros atuais.</div>`;
    return;
  }

  const axis = profile.axes.find((item) => item.axis === state.activeAxis) || profile.axes[0];
  if (!axis) {
    els.reportView.innerHTML = `<div class="empty-state">Nenhum eixo possui valores para este recorte.</div>`;
    return;
  }

  state.activeAxis = axis.axis;
  const records = filteredRecords().filter((record) => record.code === profile.code && record.axis === axis.axis);
  const actions = groupActions(records).slice(0, 10);
  const agencies = groupBy(records, "agency")
    .map(([agency, items]) => ({ agency, total: sum(items, "value"), records: items.length }))
    .sort((a, b) => b.total - a.total);
  const mainAction = actions[0];
  const share = profile.total ? axis.total / profile.total : 0;

  els.reportView.innerHTML = `
    <section class="report-card">
      <span class="eyebrow">Relatório analítico</span>
      <h3>${escapeHtml(axis.axis)}</h3>
      <p class="report-summary">
        Em ${escapeHtml(profile.name)}, este eixo soma <strong>${currency.format(axis.total)}</strong>,
        representando <strong>${percentFmt.format(share)}</strong> do investimento identificado no município.
        ${mainAction ? `A principal ação é "${escapeHtml(mainAction.action)}", com ${currency.format(mainAction.total)}.` : ""}
      </p>
      ${recommendationCards(profile, axis, agencies)}
      <div class="info-grid" style="margin-top:14px;">
        ${infoCard("Total do eixo", compactCurrency.format(axis.total), `${numberFmt.format(axis.records)} registros`, true)}
        ${infoCard("Órgãos envolvidos", agencies.map((item) => item.agency).join(", ") || "-", "agrupado pela planilha")}
        ${infoCard("Invest. per capita", valueOrDash(profile.indicators?.investmentPerCapita, (v) => currency.format(v)), "base municipal geral")}
        ${infoCard("IFDM geral", profile.indicators?.firjan ? profile.indicators.firjan.ifdm.toFixed(4).replace(".", ",") : "-", "FIRJAN 2025")}
      </div>
      <div class="section-label">Ações do eixo</div>
      <div class="action-list">
        ${
          actions.length
            ? actions.map(actionItem).join("")
            : `<div class="empty-state">Nenhuma ação encontrada neste eixo para o filtro atual.</div>`
        }
      </div>
    </section>
  `;
}

function executiveBrief(profile, records) {
  const ranked = getRankedMunicipalities(records).filter((item) => item.total > 0);
  const medianInvestment = median(ranked.map((item) => item.total));
  const stateTotal = sum(records, "value");
  const municipalityShare = stateTotal ? profile.total / stateTotal : 0;
  const concentration = profile.axes[0] && profile.total ? profile.axes[0].total / profile.total : 0;
  const currentPerCapita =
    profile.indicators?.population && profile.total ? profile.total / profile.indicators.population : profile.indicators?.investmentPerCapita;
  const allPerCapita = ranked
    .map((item) => {
      const municipality = data.municipalities.find((base) => base.code === item.code);
      return municipality?.indicators?.population ? item.total / municipality.indicators.population : null;
    })
    .filter((value) => value !== null && Number.isFinite(value));
  const medianPerCapita = median(allPerCapita);
  const ifdm = profile.indicators?.firjan?.ifdm;
  const ifdmLabel = ifdm ? (ifdm >= 0.8 ? "alto desenvolvimento" : ifdm >= 0.6 ? "desenvolvimento moderado" : "ponto de atenção") : "sem IFDM";
  const rankPercent = ranked.length ? profile.rank / ranked.length : 1;
  const leadershipLabel = rankPercent <= 0.2 ? "alta prioridade no portfólio" : rankPercent <= 0.5 ? "posição intermediária" : "baixa concentração relativa";

  return `
    <section class="executive-brief">
      <div class="brief-head">
        <span class="eyebrow">Leitura executiva</span>
        <p>
          ${escapeHtml(profile.name)} representa <strong>${percentFmt.format(municipalityShare)}</strong> do recorte estadual ativo,
          com ${escapeHtml(leadershipLabel)} e perfil FIRJAN de ${escapeHtml(ifdmLabel)}.
        </p>
      </div>
      <div class="insight-chips">
        ${insightChip("Ranking", `#${profile.rank} de ${ranked.length || data.kpis.municipalities}`)}
        ${insightChip("Concentração", percentFmt.format(concentration))}
        ${insightChip("Participação RO", percentFmt.format(municipalityShare))}
      </div>
      <div class="benchmark-grid">
        ${benchmarkCard("Investimento vs mediana", profile.total, medianInvestment, currency)}
        ${benchmarkCard("Per capita vs mediana", currentPerCapita, medianPerCapita, currency)}
      </div>
    </section>
  `;
}

function insightChip(label, value) {
  return `
    <article class="insight-chip">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function benchmarkCard(label, value, baseline, formatter) {
  const safeValue = Number(value || 0);
  const safeBaseline = Number(baseline || 0);
  const ratio = safeBaseline ? safeValue / safeBaseline : 0;
  const width = Math.max(4, Math.min(100, ratio * 50));
  const delta = safeBaseline ? (safeValue - safeBaseline) / safeBaseline : null;
  const status = delta === null ? "Sem base" : delta >= 0 ? `${percentFmt.format(delta)} acima` : `${percentFmt.format(Math.abs(delta))} abaixo`;

  return `
    <article class="benchmark-card">
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(valueOrDash(safeValue, formatter.format))}</strong>
      </div>
      <em>${escapeHtml(status)}</em>
      <div class="benchmark-track" aria-hidden="true"><i style="width:${width}%"></i></div>
    </article>
  `;
}

function recommendationCards(profile, axis, agencies) {
  const axisShare = profile.total ? axis.total / profile.total : 0;
  const leadAgency = agencies[0]?.agency || "órgão líder";
  const ifdm = profile.indicators?.firjan?.ifdm;
  const recommendations = [
    {
      label: "Decisão",
      title: axisShare > 0.65 ? "Reduzir dependência de eixo único" : "Manter carteira equilibrada",
      text:
        axisShare > 0.65
          ? "O eixo concentra parcela relevante do município. Avalie complementaridade com saúde, educação e desenvolvimento econômico."
          : "A distribuição atual permite leitura comparativa entre eixos sem perda de foco executivo.",
    },
    {
      label: "Governança",
      title: `Alinhar com ${leadAgency}`,
      text: "Use o órgão com maior volume no eixo como ponto focal para validar andamento, entregas e próximos marcos.",
    },
    {
      label: "Impacto",
      title: ifdm && ifdm < 0.6 ? "Priorizar retorno social mensurável" : "Conectar investimento a resultado",
      text:
        ifdm && ifdm < 0.6
          ? "O IFDM indica atenção. Relacione o investimento com metas de emprego, saúde, educação e acesso a serviços."
          : "Cruze valor aplicado com indicadores municipais para demonstrar resultado público além do desembolso.",
    },
  ];

  return `
    <div class="advisory-grid">
      ${recommendations
        .map(
          (item) => `
            <article class="advisory-card">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.text)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function actionItem(item) {
  return `
    <article class="action-item">
      <div>
        <strong>${escapeHtml(item.action)}</strong>
        <span>${escapeHtml(item.agency)} | ${numberFmt.format(item.records)} registro(s)</span>
      </div>
      <em>${compactCurrency.format(item.total)}</em>
    </article>
  `;
}

function currentProfileAndAxis() {
  const records = filteredRecords();
  const profile = getMunicipalityProfile(state.selectedCode, records);
  const axis = profile?.axes.find((item) => item.axis === state.activeAxis) || profile?.axes?.[0];
  const axisRecords =
    profile && axis ? records.filter((record) => record.code === profile.code && record.axis === axis.axis) : [];
  const actions = groupActions(axisRecords).slice(0, 12);
  return { profile, axis, actions };
}

function exportCurrentReport() {
  const { profile, axis, actions } = currentProfileAndAxis();
  if (!profile || !axis) return;

  const reportWindow = window.open("", "_blank", "width=920,height=1100");
  if (!reportWindow) {
    alert("O navegador bloqueou a janela de exportação. Libere pop-ups para gerar o PDF.");
    return;
  }

  reportWindow.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Relatório Negócios Inteligentes - ${escapeHtml(profile.name)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #eef3ff;
            color: #111727;
            font-family: Inter, Arial, sans-serif;
          }
          .sheet {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            padding: 18mm;
            background: #fff;
          }
          .top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            border-bottom: 4px solid #123cc8;
            padding-bottom: 18px;
          }
          .top img { max-width: 230px; max-height: 70px; object-fit: contain; }
          .kicker {
            color: #2458e8;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 0;
            text-transform: uppercase;
          }
          h1, h2, h3, p { margin: 0; }
          h1 { margin-top: 4px; color: #061a75; font-size: 28px; line-height: 1.08; }
          h2 { margin-top: 20px; font-size: 21px; }
          .meta { margin-top: 7px; color: #6e7890; font-size: 12px; font-weight: 700; }
          .grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-top: 18px;
          }
          .card {
            border: 1px solid #dfe5f3;
            border-radius: 12px;
            padding: 13px;
            background: #fbfcff;
          }
          .card.dark { background: #25273b; color: #fff; }
          .card span {
            display: block;
            color: #6e7890;
            font-size: 10px;
            font-weight: 900;
            text-transform: uppercase;
          }
          .card.dark span { color: #c8cee4; }
          .card strong { display: block; margin-top: 8px; font-size: 20px; line-height: 1.1; }
          .summary {
            margin-top: 18px;
            border-left: 5px solid ${axisColors[axis.axis] || "#20c7f4"};
            padding: 12px 14px;
            background: #f6f8ff;
            color: #3f4860;
            font-size: 14px;
            line-height: 1.5;
          }
          .actions { display: grid; gap: 8px; margin-top: 12px; }
          .action {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 14px;
            border: 1px solid #dfe5f3;
            border-radius: 10px;
            padding: 11px;
          }
          .action strong { display: block; font-size: 12px; line-height: 1.25; }
          .action span { display: block; margin-top: 4px; color: #6e7890; font-size: 11px; font-weight: 700; }
          .action em { color: #0b269a; font-style: normal; font-weight: 900; white-space: nowrap; }
          .footer {
            margin-top: 22px;
            color: #6e7890;
            font-size: 10px;
            line-height: 1.45;
          }
          @media print {
            body { background: #fff; }
            .sheet { width: auto; min-height: auto; margin: 0; padding: 0; }
          }
        </style>
      </head>
      <body>
        ${buildReportMarkup(profile, axis, actions)}
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => window.print(), 250);
          });
        <\/script>
      </body>
    </html>
  `);
  reportWindow.document.close();
}

function buildReportMarkup(profile, axis, actions) {
  const ind = profile.indicators || {};
  const firjan = ind.firjan;
  const share = profile.total ? axis.total / profile.total : 0;
  const generatedAt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());

  return `
    <main class="sheet">
      <header class="top">
        <img src="${new URL("./assets/ni-logo.svg", window.location.href).href}" alt="Negócios Inteligentes" />
        <div>
          <span class="kicker">Negócios Inteligentes · Investimentos por Município</span>
          <h1>${escapeHtml(profile.name)}</h1>
          <p class="meta">Relatório analítico por eixo | ${escapeHtml(axis.axis)}</p>
        </div>
      </header>

      <section class="grid">
        ${reportMetric("Investimento municipal", currency.format(profile.total), true)}
        ${reportMetric("Total do eixo", currency.format(axis.total))}
        ${reportMetric("Participação do eixo", percentFmt.format(share))}
        ${reportMetric("População", valueOrDash(ind.population, numberFmt.format))}
        ${reportMetric("PIB", valueOrDash(ind.pib, currency.format))}
        ${reportMetric("IFDM geral", firjan ? firjan.ifdm.toFixed(4).replace(".", ",") : "-")}
      </section>

      <p class="summary">
        O eixo ${escapeHtml(axis.axis)} concentra ${currency.format(axis.total)} em ${escapeHtml(profile.name)},
        equivalente a ${percentFmt.format(share)} do investimento identificado no município. O recorte consolida
        ${numberFmt.format(axis.records)} registro(s) da planilha e cruza os valores com indicadores IBGE e FIRJAN.
      </p>

      <h2>Ações Prioritárias</h2>
      <section class="actions">
        ${
          actions.length
            ? actions.map(reportActionItem).join("")
            : `<div class="card">Nenhuma ação localizada para este eixo no filtro atual.</div>`
        }
      </section>

      <p class="footer">
        Fontes: planilha de ações das secretarias, GeoJSON municipal de Rondônia, IBGE/SIDRA e FIRJAN IFDM.
        Exportado em ${generatedAt}. Os valores refletem os filtros ativos no dashboard.
      </p>
    </main>
  `;
}

function reportMetric(label, value, dark = false) {
  return `
    <article class="card ${dark ? "dark" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function reportActionItem(item) {
  return `
    <article class="action">
      <div>
        <strong>${escapeHtml(item.action)}</strong>
        <span>${escapeHtml(item.agency)} | ${numberFmt.format(item.records)} registro(s)</span>
      </div>
      <em>${currency.format(item.total)}</em>
    </article>
  `;
}

function shareReportText() {
  const { profile, axis } = currentProfileAndAxis();
  if (!profile || !axis) return "";
  return [
    `Negócios Inteligentes · Investimentos por Município - ${profile.name}`,
    `Eixo: ${axis.axis}`,
    `Investimento total do município: ${currency.format(profile.total)}`,
    `Investimento no eixo: ${currency.format(axis.total)}`,
    `Acesse o BI: ${window.location.href}`,
  ].join("\n");
}

function shareByEmail() {
  const { profile } = currentProfileAndAxis();
  const subject = encodeURIComponent(`Relatório Negócios Inteligentes - ${profile?.name || "Rondônia"}`);
  const body = encodeURIComponent(shareReportText());
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

function shareByWhatsApp() {
  const text = shareReportText();
  if (!text) return;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

async function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return;
  }

  alert(
    "Para instalar no Android, use o menu do navegador e toque em Instalar app. No iPhone, toque em Compartilhar e depois em Adicionar à Tela de Início.",
  );
}

function renderTabs() {
  els.tabButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.tab === state.activeTab));
  document.querySelectorAll(".panel-view").forEach((view) => view.classList.remove("is-active"));
  document.querySelector(`#${state.activeTab}View`)?.classList.add("is-active");
}

function showTooltip(event, code) {
  const profile = getMunicipalityProfile(code, filteredRecords());
  if (!profile) return;
  els.tooltip.innerHTML = `
    <strong>${escapeHtml(profile.name)}</strong>
    <div>${currency.format(profile.total)}</div>
    <div>${numberFmt.format(profile.records)} registros | #${profile.rank}</div>
  `;
  els.tooltip.hidden = false;
  els.tooltip.style.left = `${event.clientX + 14}px`;
  els.tooltip.style.top = `${event.clientY + 14}px`;
}

function getMunicipalityProfile(code, records) {
  const base = data.municipalities.find((item) => item.code === code);
  if (!base) return null;
  const municipalityRecords = records.filter((record) => record.code === code);
  const ranked = getRankedMunicipalities(records);
  const rankedItem = ranked.find((item) => item.code === code);
  const total = sum(municipalityRecords, "value");
  const axes = groupBy(municipalityRecords, "axis")
    .map(([axis, items]) => ({ axis, total: sum(items, "value"), records: items.length }))
    .sort((a, b) => b.total - a.total);

  return {
    code,
    name: base.name,
    total,
    records: municipalityRecords.length,
    rank: rankedItem?.rank || base.rank,
    indicators: base.indicators,
    axes,
  };
}

function getRankedMunicipalities(records) {
  const byCode = new Map(data.municipalities.map((item) => [item.code, { code: item.code, name: item.name, total: 0, records: 0 }]));
  records.forEach((record) => {
    const item = byCode.get(record.code);
    if (!item) return;
    item.total += record.value;
    item.records += 1;
  });
  return [...byCode.values()]
    .sort((a, b) => b.total - a.total)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function totalsByMunicipality(records) {
  return records.reduce((acc, record) => {
    acc[record.code] = (acc[record.code] || 0) + record.value;
    return acc;
  }, {});
}

function groupActions(records) {
  const grouped = new Map();
  records.forEach((record) => {
    const key = `${record.action}|${record.agency}`;
    if (!grouped.has(key)) {
      grouped.set(key, { action: record.action, agency: record.agency, total: 0, records: 0 });
    }
    const item = grouped.get(key);
    item.total += record.value;
    item.records += 1;
  });
  return [...grouped.values()].sort((a, b) => b.total - a.total);
}

function groupBy(items, key) {
  const grouped = new Map();
  items.forEach((item) => {
    const value = item[key];
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(item);
  });
  return [...grouped.entries()];
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function infoCard(label, value, detail, dark = false) {
  return `
    <article class="info-card ${dark ? "dark" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail || "")}</small>
    </article>
  `;
}

function metricRow(label, value) {
  const width = Math.max(0, Math.min(100, value * 100));
  return `
    <div class="metric-row">
      <span>${escapeHtml(label)}</span>
      <div class="metric-line"><i style="width:${width}%"></i></div>
      <strong>${value.toFixed(3).replace(".", ",")}</strong>
    </div>
  `;
}

function valueOrDash(value, formatter) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return formatter(value);
}

function mapColor(value, max) {
  if (!value || !max) return "#e9effa";
  const t = Math.log1p(value) / Math.log1p(max);
  if (t > 0.75) return mix("#6658ff", "#061a75", (t - 0.75) / 0.25);
  if (t > 0.4) return mix("#20c7f4", "#6658ff", (t - 0.4) / 0.35);
  return mix("#dff7ff", "#20c7f4", t / 0.4);
}

function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const next = ca.map((channel, index) => Math.round(channel + (cb[index] - channel) * Math.max(0, Math.min(1, t))));
  return `rgb(${next[0]}, ${next[1]}, ${next[2]})`;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
}

function geometryPath(geometry, project) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) => ringPath(ring, project)).join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon.map((ring) => ringPath(ring, project))).join(" ");
  }
  return "";
}

function ringPath(ring, project) {
  return ring
    .map((point, index) => {
      const [x, y] = project(point);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ")
    .concat(" Z");
}

function collectCoordinates(value) {
  if (!Array.isArray(value)) return [];
  if (typeof value[0] === "number") return [value];
  return value.flatMap(collectCoordinates);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
