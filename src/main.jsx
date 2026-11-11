import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const SCENARIOS = [
  { key: "base", name: "Базовый", note: "Штатное выполнение плана", icon: "◉" },
  { key: "demand", name: "Повышенный спрос", note: "План выпуска +50%", icon: "↗" },
  { key: "limited-supply", name: "Ограничение сырья", note: "Запас молока — 8 000 л", icon: "◌" },
  { key: "line-down", name: "Простой линии", note: "Доступна одна линия", icon: "Ⅱ" },
  { key: "overconsumption", name: "Избыточный расход", note: "Искусственное отклонение", icon: "!" }
];

const NAV_ITEMS = [
  { id: "overview", label: "Обзор цеха", icon: "▦" },
  { id: "models", label: "Модели и прогноз", icon: "⌁" },
  { id: "scenarios", label: "Сценарии", icon: "◷" }
];

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value ?? 0);
}

function Status({ status }) {
  const labels = { working: "Работает", standby: "Ожидание", warning: "Предупреждение" };
  return <span className={`status status--${status}`}><i />{labels[status] ?? status}</span>;
}

function Icon({ name }) {
  const paths = {
    output: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 14 4-4 3 2 6-7" /></>,
    energy: <path d="m13 2-3 8h7l-6 12 2-9H6l7-11Z" />,
    water: <><path d="M12 3s7 7.3 7 12a7 7 0 0 1-14 0c0-4.7 7-12 7-12Z" /><path d="M9 17a3.5 3.5 0 0 0 3 1.5" /></>,
    load: <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19H2" /></>,
    arrow: <><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function MetricCard({ title, value, unit, icon, change, tone = "blue" }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-icon--${tone}`}><Icon name={icon} /></div>
      <div className="metric-copy">
        <p>{title}</p>
        <div className="metric-value">{value}<span>{unit}</span></div>
        <small>{change}</small>
      </div>
      <span className="metric-arrow"><Icon name="arrow" /></span>
    </article>
  );
}

function LineChart({ data, resource = "электроэнергии", unit = "кВт·ч" }) {
  const width = 780;
  const height = 244;
  const padding = { top: 16, right: 12, bottom: 30, left: 44 };
  const values = data.flatMap((point) => [point.actual, point.predicted]);
  const min = Math.floor(Math.min(...values) / 5) * 5;
  const max = Math.ceil(Math.max(...values) / 5) * 5;
  const x = (index) => padding.left + index * (width - padding.left - padding.right) / Math.max(data.length - 1, 1);
  const y = (value) => height - padding.bottom - (value - min) * (height - padding.top - padding.bottom) / Math.max(max - min, 1);
  const makePath = (key) => data.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
  const actualPath = makePath("actual");
  const predictionPath = makePath("predicted");
  const areaPath = `${actualPath} L${x(data.length - 1)},${height - padding.bottom} L${x(0)},${height - padding.bottom} Z`;
  const guides = Array.from({ length: 4 }, (_, index) => min + (max - min) * index / 3);

  return (
    <div className="chart-wrap">
      <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Фактическое и прогнозируемое потребление: ${resource}, ${unit}`}>
        {guides.map((value) => <g key={value}><line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} className="chart-grid" /><text x={padding.left - 8} y={y(value) + 4} textAnchor="end" className="chart-label">{formatNumber(value)}</text></g>)}
        <path d={areaPath} className="chart-area" />
        <path d={actualPath} className="chart-line chart-line--actual" />
        <path d={predictionPath} className="chart-line chart-line--prediction" />
        <text x={padding.left} y={height - 7} className="chart-label">Тестовый период · 15% данных</text>
      </svg>
    </div>
  );
}

function ResourceTrends({ data }) {
  const series = [
    { key: "milkFlow", name: "Расход молочного сырья", unit: "л/ч", color: "#5b82e8", icon: "↗" },
    { key: "electricity", name: "Электроэнергия", unit: "кВт·ч", color: "#e5a545", icon: "ϟ" },
    { key: "water", name: "Вода", unit: "л", color: "#51aeba", icon: "⌁" },
    { key: "output", name: "Выпуск продукции", unit: "л", color: "#46aa83", icon: "◉" }
  ];

  return (
    <section className="panel trend-panel">
      <div className="panel-heading"><div><span className="eyebrow">СИНТЕТИЧЕСКИЙ ДАТАСЕТ · ВСЕ 5 000 НАБЛЮДЕНИЙ</span><h2>Динамика ресурсов и выпуска</h2></div><span className="price-tag">Шаг · 5 минут</span></div>
      <div className="resource-trends">{series.map((item) => {
        const values = data.map((record) => record[item.key]);
        const max = Math.max(...values, 1);
        const min = Math.min(...values, 0);
        const range = max - min || 1;
        const points = values.map((value, index) =>
          `${(index * 240 / Math.max(values.length - 1, 1)).toFixed(1)},${(53 - (value - min) * 45 / range).toFixed(1)}`).join(" ");
        const latest = values.at(-1) ?? 0;
        return (
          <article className="trend-card" key={item.key}>
            <div className="trend-card__heading"><span style={{ color: item.color }}>{item.icon}</span><small>{item.name}</small></div>
            <strong>{formatNumber(latest, item.key === "milkFlow" ? 0 : 1)} <small>{item.unit}</small></strong>
            <svg viewBox="0 0 240 60" aria-label={`График: ${item.name}`} role="img"><line x1="0" x2="240" y1="53" y2="53" /><polyline points={points} style={{ stroke: item.color }} /></svg>
          </article>
        );
      })}</div>
    </section>
  );
}

function Plant({ plant, selected, onSelect, forecast, activeWarning }) {
  return (
    <div className="plant-scene">
      <div className="plant-scene__grid" />
      <div className="plant-flow">
        <svg viewBox="0 0 700 88" preserveAspectRatio="none" aria-hidden="true">
          <path d="M65 45H220 M280 45H398 M458 45H592" />
          <circle cx="65" cy="45" r="4" /><circle cx="250" cy="45" r="4" /><circle cx="430" cy="45" r="4" /><circle cx="620" cy="45" r="4" />
        </svg>
      </div>
      {plant.map((item, index) => (
        <button className={`plant-unit plant-unit--${item.id} ${selected?.id === item.id ? "is-selected" : ""}`} onClick={() => onSelect(item)} key={item.id}>
          <span className={`plant-unit__art plant-unit__art--${item.id}`}>
            {item.id === "tank" && <><span className="tank-dome" /><span className="tank-glass"><i /></span><span className="tank-leg tank-leg--left" /><span className="tank-leg tank-leg--right" /></>}
            {item.id === "pasteurizer" && <><span className="machine-core" /><span className="machine-tube machine-tube--one" /><span className="machine-tube machine-tube--two" /><span className="machine-light" /></>}
            {item.id === "cooler" && <><span className="cooler-body"><i /><i /><i /><i /></span><span className="cooler-foot" /></>}
            {item.id === "filler" && <><span className="filler-roof" /><span className="filler-body"><i /><i /><i /></span><span className="filler-belt" /></>}
          </span>
          <span className="plant-unit__label">{item.name}</span>
          <Status status={item.status} />
        </button>
      ))}
      <div className="plant-overlay plant-overlay--top"><span className="pulse-dot" /> LIVE SIMULATION <b>5 MIN STEP</b></div>
      <div className="plant-overlay plant-overlay--bottom"><Icon name="energy" /><span>Прогноз энергии</span><strong>{forecast} кВт·ч</strong>{activeWarning && <em>Отклонение</em>}</div>
    </div>
  );
}

function EquipmentDetails({ item, forecast, waterForecast, recommendation }) {
  if (!item) return <div className="equipment-empty">Выберите объект на схеме цеха,<br />чтобы посмотреть параметры.</div>;
  const details = item.id === "pasteurizer"
    ? [["Температура", "72 °C"], ["Давление", "2,5 бар"], ["Энергия, факт", "10,8 кВт·ч"], ["Прогноз энергии", `${forecast} кВт·ч`]]
    : item.id === "tank"
      ? [["Сырьё", "Молоко"], ["Температура", "5,4 °C"], ["Заполнение", item.value], ["Подача", "8 100 л/ч"]]
      : item.id === "cooler"
      ? [["Температура продукта", "6 °C"], ["Загрузка", "76%"], ["Вода, факт", "83 л"], ["Прогноз воды", `${waterForecast} л`]]
        : [["Линия", "№ 1"], ["Загрузка", item.value], ["Выпуск", "684 л / интервал"], ["Режим", "Пастеризованное молоко"]];
  return (
    <div className="equipment-details">
      <div className="equipment-heading"><span className="equipment-avatar">⌘</span><div><h3>{item.name}</h3><Status status={item.status} /></div></div>
      <div className="equipment-specs">{details.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      <div className="operator-tip"><span>РЕКОМЕНДАЦИЯ</span><p>{recommendation}</p></div>
    </div>
  );
}

function ModelTable({ data, unit }) {
  const entries = [
    ["baseline", "Наивный прогноз", "Текущий интервал → следующий"],
    ["linear", "Линейная регрессия", "МНК · масштабирование train-only"],
    ["forest", "Случайный лес", "12 деревьев · глубина 4"],
    ["conv1d", "1D CNN", "Окно 12 · 5 фильтров · ранняя остановка"]
  ];
  return (
    <div className="table-scroll">
      <table className="model-table">
        <thead><tr><th>Модель</th><th>Настройки</th><th>MAE <small>{unit}</small></th><th>RMSE <small>{unit}</small></th><th>R²</th></tr></thead>
        <tbody>{entries.map(([key, name, detail]) => {
          const result = data?.[key];
          return <tr key={key}><td><b>{name}</b></td><td className="model-detail">{detail}</td><td>{formatNumber(result?.mae, 3)}</td><td>{formatNumber(result?.rmse, 3)}</td><td><span className="r2-pill">{formatNumber(result?.r2, 3)}</span></td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function PlanCards({ plan, selected, onSelect }) {
  const items = [["source", "Исходный режим", plan?.source], ["recommended", "Рекомендуемый", plan?.recommended]];
  return <div className="plan-grid">{items.map(([key, label, values]) => (
    <button className={`plan-card ${key === selected ? "plan-card--selected" : ""}`} onClick={() => onSelect(key)} key={key}>
      <span className="plan-card__top"><span>{label}</span>{key === "recommended" && <em>РЕКОМЕНДУЕМ</em>}</span>
      <strong>{formatNumber(values?.cost, 2)} <small>тг</small></strong>
      <span className="plan-card__meta">{formatNumber(values?.output)} л выпуска · {formatNumber(values?.energy, 1)} кВт·ч</span>
      <span className="plan-card__meta">{values?.lines} {values?.lines === 1 ? "линия" : "линии"} · старт {values?.startAt} · сдвиг {values?.shiftMinutes > 0 ? "+" : ""}{values?.shiftMinutes} мин</span>
      <span className="plan-card__meta">{values?.constraintsMet ? "план выполнен" : "есть ограничение"}</span>
    </button>
  ))}</div>;
}

function Overview({ data, selectedEquipment, setSelectedEquipment, schedule, setSchedule, setTab }) {
  const chosenSchedule = schedule === "source" ? data.plan.source : data.plan.recommended;
  const activeEquipment = data.plant.find((item) => item.id === selectedEquipment?.id) ?? null;
  return (
    <>
      <section className="metric-grid">
        <MetricCard title="Выпуск продукции" value={formatNumber(chosenSchedule.output)} unit=" л" icon="output" change="Пастеризованное молоко" tone="blue" />
        <MetricCard title="Энергия за план" value={formatNumber(chosenSchedule.energy, 1)} unit=" кВт·ч" icon="energy" change={`${formatNumber(chosenSchedule.energyPerLiter, 4)} кВт·ч / л`} tone="amber" />
        <MetricCard title="Вода за план" value={formatNumber(chosenSchedule.water, 1)} unit=" л" icon="water" change={`Прогноз следующего интервала: ${formatNumber(data.forecast.water, 1)} л · ${formatNumber(chosenSchedule.waterPerLiter, 3)} л/л`} tone="cyan" />
        <MetricCard title="Загрузка оборудования" value={formatNumber(data.metrics.averageLoad, 1)} unit="%" icon="load" change={`${formatNumber(data.metrics.activeBatches)} партий в датасете`} tone="violet" />
      </section>

      {data.forecast.activeWarning && <div className="warning-banner"><span>!</span><div><b>Обнаружено отклонение потребления энергии</b><p>Ошибка прогноза выше порога в нескольких интервалах. Требуется проверка режима работы оборудования; причина автоматически не определяется.</p></div></div>}

      <section className="main-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span className="eyebrow">МОДЕЛЬ · СЛУЧАЙНЫЙ ЛЕС</span><h2>Потребление электроэнергии</h2></div><button className="link-button" onClick={() => setTab("models")}>Все модели <span>→</span></button></div>
          <div className="chart-summary"><strong>{formatNumber(data.forecast.electricity, 2)} <small>кВт·ч</small></strong><span>прогноз следующего интервала</span><Status status={data.forecast.activeWarning ? "warning" : "working"} /></div>
          <LineChart data={data.chart} />
          <div className="chart-legend"><span><i className="legend-dot legend-dot--blue" />Факт</span><span><i className="legend-dot legend-dot--dash" />Прогноз</span><small>Шаг данных — 5 минут</small></div>
        </article>

        <article className="panel plant-panel">
          <div className="panel-heading"><div><span className="eyebrow">НАСТОЛЬНЫЙ ПРОТОТИП</span><h2>Виртуальный цех</h2></div><span className="live-tag"><i /> ONLINE</span></div>
          <Plant plant={data.plant} selected={activeEquipment} onSelect={setSelectedEquipment} forecast={formatNumber(data.forecast.electricity, 2)} activeWarning={data.forecast.activeWarning} />
          <div className="plant-footer">
            <EquipmentDetails item={activeEquipment} forecast={formatNumber(data.forecast.electricity, 2)} waterForecast={formatNumber(data.forecast.water, 1)} recommendation={data.recommendation} />
            <div className="shift-select"><span>РАСПИСАНИЕ</span><div className="segmented-control"><button className={schedule === "source" ? "is-active" : ""} onClick={() => setSchedule("source")}>Исходное</button><button className={schedule === "recommended" ? "is-active" : ""} onClick={() => setSchedule("recommended")}>Рекомендуемое</button></div></div>
          </div>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel compact-panel">
          <div className="panel-heading"><div><span className="eyebrow">ПЛАН ВЫПУСКА</span><h2>Сравнение режимов</h2></div><span className="price-tag">Энергия · 30 тг/кВт·ч</span></div>
          <PlanCards plan={data.plan} selected={schedule} onSelect={setSchedule} />
          {!data.plan.feasible && <p className="constraint-note">Ограничение ресурсов не позволяет выполнить полный план. Сравнение не учитывает недовыпуск как экономию.</p>}
        </article>
        <article className="panel compact-panel">
          <div className="panel-heading"><div><span className="eyebrow">КОНТРОЛЬ ОТКЛОНЕНИЙ</span><h2>Состояние системы</h2></div><span className="alert-count">{data.events.reduce((sum, event) => sum + event.count, 0)}<small> точек</small></span></div>
          <div className="anomaly-list">
            <div className="anomaly-row"><span className="anomaly-icon">⌁</span><div><b>Порог ошибки прогноза</b><small>95-й процентиль валидационной ошибки · {formatNumber(data.forecast.threshold, 3)} кВт·ч</small></div><strong>{data.forecast.activeWarning ? "АКТИВНО" : "НОРМА"}</strong></div>
            <div className="anomaly-row"><span className="anomaly-icon anomaly-icon--warm">!</span><div><b>Синтетическое отклонение</b><small>{data.events[0] ? `${formatNumber(data.events[0].count)} интервалов · ${new Date(data.events[0].from).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` : "Не обнаружено"}</small></div><span className="anomaly-history">ИСТОРИЯ</span></div>
          </div>
          <button className="text-link" onClick={() => setTab("scenarios")}>Исследовать сценарии <span>→</span></button>
        </article>
      </section>
      <ResourceTrends data={data.resourceTrends} />
    </>
  );
}

function ModelsPage({ data }) {
  const [period, setPeriod] = useState("testResults");
  const [resource, setResource] = useState("electricity");
  const isWater = resource === "water";
  const metrics = isWater
    ? period === "testResults" ? data.waterTestResults : data.waterValidationResults
    : data[period];
  const chart = isWater ? data.waterChart : data.chart;
  return (
    <section className="panel page-panel">
      <div className="panel-heading"><div><span className="eyebrow">ПРОГНОЗ РЕСУРСОВ · СЛЕДУЮЩИЙ ИНТЕРВАЛ</span><h2>Сравнение моделей</h2></div><div className="model-selectors"><select className="select-control" value={resource} onChange={(event) => setResource(event.target.value)}><option value="electricity">Электроэнергия · кВт·ч</option><option value="water">Вода · л</option></select><select className="select-control" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="testResults">Тестовый период</option><option value="validationResults">Валидационный период</option></select></div></div>
      <p className="section-description">Порядок наблюдений сохранён: 70% обучение, 15% валидация и 15% тест. Порог аномалии рассчитан только по валидационным остаткам.</p>
      <ModelTable data={metrics} unit={isWater ? "л" : "кВт·ч"} />
      <div className="models-info-grid"><div><b>Без утечки будущих данных</b><p>Признаки берутся из текущего интервала: режим, температура, загрузка, расход и предыдущие показания. Будущий выпуск и будущие измерения не используются.</p></div><div><b>Проверка датасета</b><p>{data.dataset.quality.valid ? "Проверка пройдена" : "Обнаружены проблемы"}: {formatNumber(data.dataset.quality.records)} строк, пропусков — {data.dataset.quality.missingValues}, дубликатов временных меток — {data.dataset.quality.duplicateTimestamps}, нарушений порядка — {data.dataset.quality.outOfOrderTimestamps}, разрывов шага — {data.dataset.quality.intervalGaps}.</p></div><div><b>Глубокое обучение</b><p>Одномерная свёрточная сеть обучается на окне из 12 шагов и четырёх каналах: энергия, вода, загрузка и температура. Применяется ранняя остановка по валидационной ошибке.</p></div><div><b>Качество обнаружения энергии</b><p>На тестовом периоде: precision {formatNumber(data.anomalyMetrics.precision, 3)}, recall {formatNumber(data.anomalyMetrics.recall, 3)}, задержка {data.anomalyMetrics.detectionDelayIntervals ?? "—"} интервалов. Предупреждение — после 3 ошибок подряд выше порога.</p></div></div>
      <div className="panel-subheading"><div><span className="eyebrow">ФАКТ И ПРОГНОЗ</span><h2>Тестовая выборка</h2></div></div>
      <LineChart data={chart} resource={isWater ? "воды" : "электроэнергии"} unit={isWater ? "л" : "кВт·ч"} />
      <p className="chart-footnote">Данные симуляционные. Значения метрик иллюстрируют работу прототипа и не являются подтверждением экономии или точности на реальном производстве.</p>
    </section>
  );
}

function ScenariosPage({ data, selectedScenario, setSelectedScenario, schedule, setSchedule }) {
  return (
    <div className="scenario-page">
      <section className="panel page-panel">
        <div className="panel-heading"><div><span className="eyebrow">ЭКСПЕРИМЕНТАЛЬНЫЕ УСЛОВИЯ</span><h2>Выберите сценарий</h2></div><span className="simulation-tag">Все данные — симуляционные</span></div>
        <div className="scenario-grid">{SCENARIOS.map((scenario) => <button className={`scenario-card ${selectedScenario === scenario.key ? "scenario-card--active" : ""}`} key={scenario.key} onClick={() => setSelectedScenario(scenario.key)}><span className="scenario-symbol">{scenario.icon}</span><b>{scenario.name}</b><small>{scenario.note}</small><span className="scenario-check">{selectedScenario === scenario.key ? "Выбран" : "Изучить →"}</span></button>)}</div>
      </section>
      <section className="panel page-panel">
        <div className="panel-heading"><div><span className="eyebrow">ОДИНАКОВЫЕ ИСХОДНЫЕ УСЛОВИЯ</span><h2>Расчёт ресурсов и затрат</h2></div></div>
        <PlanCards plan={data.plan} selected={schedule} onSelect={setSchedule} />
        <p className="chart-footnote">{data.plan.recommendationMethod}</p>
        <div className={`scenario-result ${data.plan.feasible ? "" : "scenario-result--warning"}`}><span>{data.plan.feasible ? "✓" : "!"}</span><div><b>{data.plan.feasible ? "План выполним при заданных ограничениях" : "Производственный план превышает доступные ресурсы"}</b><p>{data.recommendation} Снижение затрат не засчитывается, если план выпуска не выполнен.</p></div></div>
        <div className="comparison-table"><div><b>Показатель</b><b>Исходный</b><b>Рекомендуемый</b></div>{[["Выпуск продукции, л", "output"], ["Энергия, кВт·ч", "energy"], ["Вода, л", "water"], ["Энергия на литр, кВт·ч/л", "energyPerLiter"], ["Вода на литр, л/л", "waterPerLiter"], ["Затраты, тг", "cost"]].map(([label, key]) => <div key={key}><span>{label}</span><span>{formatNumber(data.plan.source[key], key.includes("PerLiter") ? 4 : 1)}</span><span>{formatNumber(data.plan.recommended[key], key.includes("PerLiter") ? 4 : 1)}</span></div>)}<div><span>Выполнение ограничений</span><span>{data.plan.source.constraintsMet ? "Да" : "Нет"}</span><span>{data.plan.recommended.constraintsMet ? "Да" : "Нет"}</span></div></div>
      </section>
      <section className="panel page-panel questions-panel"><div className="panel-heading"><div><span className="eyebrow">КОНТРОЛЬНЫЕ ВОПРОСЫ</span><h2>Ключевые выводы</h2></div></div><div className="question-list"><p><b>Почему делим данные по времени?</b> Чтобы тестовая часть имитировала будущее и не передавала сведения из будущих интервалов в обучение.</p><p><b>Что означает предупреждение?</b> Необычную ошибку прогноза, а не установленную причину поломки.</p><p><b>Что обязательно при выборе режима?</b> План выпуска, запас сырья, доступность линий, санитарные и температурные ограничения.</p><p><b>Что нужно до применения на предприятии?</b> Проверить модель на обезличенных реальных данных, согласовать технологические лимиты, оценить безопасность и провести контролируемую валидацию.</p></div></section>
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [scenario, setScenario] = useState("base");
  const [schedule, setSchedule] = useState("recommended");
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/overview?scenario=${scenario}&schedule=${schedule}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Ошибка API: ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        setData(payload);
        setError("");
      })
      .catch((fetchError) => {
        if (fetchError.name !== "AbortError") setError(fetchError.message);
      });
    return () => controller.abort();
  }, [scenario, schedule]);

  const selectedScenarioName = useMemo(() => SCENARIOS.find((item) => item.key === scenario)?.name ?? "Базовый", [scenario]);

  if (!data && !error) return <div className="loading-screen"><span className="loader" />Загружаем симуляцию и модели…</div>;
  if (error) return <div className="error-screen"><b>Не удалось загрузить данные</b><span>{error}. Убедитесь, что запущен сервер npm run dev.</span><button onClick={() => location.reload()}>Повторить</button></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><b>Молочный цех</b><small>RESOURCE CONTROL</small></div></div>
        <div className="sidebar-label">РАБОЧАЯ ОБЛАСТЬ</div>
        <nav>{NAV_ITEMS.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={tab === item.id ? "nav-item nav-item--active" : "nav-item"}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === "overview" && <i className="nav-badge" />}</button>)}</nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-status"><span className="live-dot" /><div><b>Симуляция активна</b><small>{formatNumber(data.dataset.records)} наблюдений</small></div><span className="status-menu">···</span></div>
        <div className="sidebar-foot">Учебный прототип <span>v1.0</span></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">Производство <span>/</span> <b>{NAV_ITEMS.find((item) => item.id === tab)?.label}</b></div><div className="topbar-actions"><span className="scenario-chip"><i />{selectedScenarioName}</span><span className="topbar-divider" /><button className="refresh-button" title="Обновлено по симуляционным данным"><Icon name="clock" /><span>Обновлено {new Date(data.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span></button><div className="avatar">ТП</div></div></header>
        <div className="page-content">
          <div className="page-title"><div><div className="page-kicker"><span className="live-dot" /> ЛИНИЯ ПАСТЕРИЗОВАННОГО МОЛОКА <span className="title-separator">·</span> 5-МИНУТНЫЙ ИНТЕРВАЛ</div><h1>{tab === "overview" ? "Панель управления" : tab === "models" ? "Модели и прогноз" : "Сценарии производства"}</h1><p>{tab === "overview" ? "Мониторинг ресурсов и состояния оборудования в реальном времени" : tab === "models" ? "Оценка точности моделей на хронологически отложенных данных" : "Проверка вариантов расписания и ограничений ресурсов"}</p></div><div className="date-stamp"><span>ДАТАСЕТ</span><b>{new Date(data.dataTimestamp).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</b></div></div>
          {tab === "overview" && <Overview data={data} selectedEquipment={selectedEquipment} setSelectedEquipment={setSelectedEquipment} schedule={schedule} setSchedule={setSchedule} setTab={setTab} />}
          {tab === "models" && <ModelsPage data={data} />}
          {tab === "scenarios" && <ScenariosPage data={data} selectedScenario={scenario} setSelectedScenario={setScenario} schedule={schedule} setSchedule={setSchedule} />}
          <footer className="page-footer"><span>Синтетические данные · seed {data.dataset.seed} · {data.dataset.stepMinutes}-минутный шаг</span><span>Время последнего обновления: {new Date(data.updatedAt).toLocaleString("ru-RU")}</span></footer>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
