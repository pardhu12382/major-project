/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Type } from "@google/genai";
import { render } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { html } from "htm/preact";
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';

Chart.register(...registerables, zoomPlugin);

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

type IrrigationEntry = {
  day: string;
  date: string;
  time: string;
  amount: string;
};

type APIResponse = {
  droughtRisk: "Low" | "Medium" | "High";
  irrigationSchedule: IrrigationEntry[];
};

const riskToNumber = { 'Low': 1, 'Medium': 2, 'High': 3 };

// A helper function to generate mock historical data
function generateHistoricalData(timeRange: '4weeks' | '6months' | '12months') {
  const data = [];
  const riskLevels: Array<'Low' | 'Medium' | 'High'> = ['Low', 'Medium', 'High'];
  const now = new Date();

  const randomBetween = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);

  if (timeRange === '4weeks') {
    for (let i = 3; i >= 0; i--) {
      data.push({
        label: i === 0 ? 'Last Week' : `${i + 1} Weeks Ago`,
        temp: randomBetween(25, 35),
        irrigation: randomBetween(20, 60),
        risk: riskLevels[randomBetween(0, 2)],
        humidity: randomBetween(40, 65),
      });
    }
     return data.reverse();
  } else if (timeRange === '6months') {
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      data.push({
        label: date.toLocaleString('default', { month: 'short' }),
        temp: randomBetween(15, 30),
        irrigation: randomBetween(30, 70),
        risk: riskLevels[randomBetween(0, 2)],
        humidity: randomBetween(50, 75),
      });
    }
    return data;
  } else if (timeRange === '12months') {
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      data.push({
        label: date.toLocaleString('default', { month: 'short' }),
        temp: randomBetween(10, 35),
        irrigation: randomBetween(25, 80),
        risk: riskLevels[randomBetween(0, 2)],
        humidity: randomBetween(45, 80),
      });
    }
    return data;
  }
  return [];
}


function ChartWrapper({ type, data, options }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        chartRef.current = new Chart(ctx, {
          type,
          data,
          options,
        });
      }
    }
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [type, data, options]);

  return html`<canvas ref=${canvasRef}></canvas>`;
}

function App() {
  const [formData, setFormData] = useState({
    location: "California, USA",
    cropType: "Almonds",
    soilType: "Sandy Loam",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<APIResponse | null>(null);
  const [timeRange, setTimeRange] = useState<'4weeks' | '6months' | '12months'>('4weeks');
  const [visibleCharts, setVisibleCharts] = useState({
    temp: true,
    humidity: true,
    irrigation: true,
    risk: true,
  });

  const historicalData = useMemo(() => generateHistoricalData(timeRange), [timeRange]);

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    setFormData({ ...formData, [target.name]: target.value });
  };

  const handleTimeRangeChange = (e: Event) => {
    const target = e.target as HTMLSelectElement;
    setTimeRange(target.value as '4weeks' | '6months' | '12months');
  };

  const handleChartVisibilityChange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      setVisibleCharts(prev => ({ ...prev, [target.name]: target.checked }));
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Fetch real-time weather data
      const weatherResponse = await fetch(`https://wttr.in/${encodeURIComponent(formData.location)}?format=j1`);
      if (!weatherResponse.ok) {
        throw new Error('Could not fetch weather data. Please check the location name.');
      }
      const weatherData = await weatherResponse.json();
      const condition = weatherData.current_condition[0];
      const currentWeather = `${condition.weatherDesc[0].value}, ${condition.temp_C}°C`;
      const currentDate = new Date().toISOString().slice(0, 10);

      const prompt = `
        Based on the following agricultural data, provide a drought risk level ('Low', 'Medium', or 'High') and a 7-day precision irrigation schedule starting from today, ${currentDate}.

        Data:
        - Location: ${formData.location}
        - Crop Type: ${formData.cropType}
        - Soil Type: ${formData.soilType}
        - Current Weather Conditions: ${currentWeather}

        Output only the drought risk and the irrigation schedule in the specified JSON format. The schedule must include the day, date, time, and amount.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              droughtRisk: {
                type: Type.STRING,
                description: "The assessed drought risk level. Can be 'Low', 'Medium', or 'High'.",
              },
              irrigationSchedule: {
                type: Type.ARRAY,
                description: "A 7-day irrigation schedule.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    day: { type: Type.STRING, description: "Day of the week." },
                    date: { type: Type.STRING, description: "Date in YYYY-MM-DD format." },
                    time: { type: Type.STRING, description: "Optimal time for irrigation." },
                    amount: { type: Type.STRING, description: "Amount of water in millimeters (mm)." },
                  },
                  required: ["day", "date", "time", "amount"],
                },
              },
            },
            required: ["droughtRisk", "irrigationSchedule"],
          },
        },
      });

      const responseText = response.text.trim();
      const parsedResult: APIResponse = JSON.parse(responseText);
      setResult(parsedResult);
    } catch (err) {
      console.error(err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };
  
  const isFormIncomplete = Object.values(formData).some(value => typeof value === 'string' && value.trim() === '');

  const chartLabels = historicalData.map(d => d.label);
  const commonChartOptions = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(33, 37, 41, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 10,
            cornerRadius: 4,
            displayColors: true,
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'xy',
            modifierKey: 'ctrl',
          },
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true,
            },
            mode: 'xy',
          },
        },
      },
      scales: {
          x: { grid: { display: false } },
          y: { grid: { color: '#e9ecef' }, ticks: { color: '#6c757d' } }
      }
  };

  const weatherChartData = {
      labels: chartLabels,
      datasets: [{
          label: 'Avg. Temp',
          data: historicalData.map(d => d.temp),
          borderColor: '#0d6efd',
          backgroundColor: 'rgba(13, 110, 253, 0.1)',
          fill: true,
          tension: 0.3,
      }]
  };
  
  const weatherChartOptions = {
      ...commonChartOptions,
      plugins: {
          ...commonChartOptions.plugins,
          tooltip: {
              ...commonChartOptions.plugins.tooltip,
              callbacks: {
                  label: (context) => `${context.dataset.label}: ${context.parsed.y} °C`,
              }
          }
      }
  };

  const irrigationChartData = {
      labels: chartLabels,
      datasets: [{
          label: 'Water Applied',
          data: historicalData.map(d => d.irrigation),
          backgroundColor: '#198754',
          borderRadius: 4,
      }]
  };
  
  const irrigationChartOptions = {
      ...commonChartOptions,
      plugins: {
          ...commonChartOptions.plugins,
          tooltip: {
              ...commonChartOptions.plugins.tooltip,
              callbacks: {
                  label: (context) => `${context.dataset.label}: ${context.parsed.y} mm`,
              }
          }
      }
  };

  const riskChartData = {
      labels: chartLabels,
      datasets: [{
          label: 'Drought Risk',
          data: historicalData.map(d => riskToNumber[d.risk]),
          borderColor: '#dc3545',
          stepped: true,
      }]
  };
  
  const riskChartOptions = {
      ...commonChartOptions,
      scales: {
          ...commonChartOptions.scales,
          y: {
              ...commonChartOptions.scales.y,
              min: 0.5,
              max: 3.5,
              ticks: {
                  stepSize: 1,
                  callback: (value: number) => {
                      return { 1: 'Low', 2: 'Medium', 3: 'High' }[value] || '';
                  }
              }
          }
      },
      plugins: {
          ...commonChartOptions.plugins,
          tooltip: {
              ...commonChartOptions.plugins.tooltip,
              callbacks: {
                  label: (context) => {
                      const value = context.parsed.y;
                      const riskLevel = { 1: 'Low', 2: 'Medium', 3: 'High' }[value] || 'Unknown';
                      return `Drought Risk: ${riskLevel}`;
                  }
              }
          }
      }
  };

  const humidityChartData = {
      labels: chartLabels,
      datasets: [{
          label: 'Avg. Humidity',
          data: historicalData.map(d => d.humidity),
          borderColor: '#fd7e14',
          backgroundColor: 'rgba(253, 126, 20, 0.1)',
          fill: true,
          tension: 0.3,
      }]
  };
  
  const humidityChartOptions = {
      ...commonChartOptions,
      plugins: {
          ...commonChartOptions.plugins,
          tooltip: {
              ...commonChartOptions.plugins.tooltip,
              callbacks: {
                  label: (context) => `${context.dataset.label}: ${context.parsed.y} %`,
              }
          }
      }
  };

  return html`
    <div class="container">
      <header>
        <h1>Precision Irrigation & Drought Risk Assessment</h1>
      </header>
      <main>
        <form onSubmit=${handleSubmit} class="input-form">
          <div class="form-grid">
            <div class="form-group">
              <label for="location">Location</label>
              <input type="text" id="location" name="location" value=${formData.location} onInput=${handleInputChange} required />
            </div>
            <div class="form-group">
              <label for="cropType">Crop Type</label>
              <input type="text" id="cropType" name="cropType" value=${formData.cropType} onInput=${handleInputChange} required />
            </div>
            <div class="form-group">
              <label for="soilType">Soil Type</label>
              <input type="text" id="soilType" name="soilType" value=${formData.soilType} onInput=${handleInputChange} required />
            </div>
          </div>
          <button type="submit" disabled=${loading || isFormIncomplete}>
            ${loading ? 'Analyzing...' : 'Generate Schedule'}
          </button>
        </form>

        <section class="results-section" aria-live="polite">
          ${loading && html`<div class="loader"></div>`}
          ${error && html`<div class="error-message" role="alert">${error}</div>`}
          ${result && html`
            <div class="results-container">
              <h2>Analysis Results</h2>
              <div class="drought-risk risk-${result.droughtRisk.toLowerCase()}">
                <h3>Drought Risk: <span>${result.droughtRisk}</span></h3>
              </div>
              <div class="irrigation-schedule">
                <h3>Irrigation Schedule</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Water Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${result.irrigationSchedule.map((item: IrrigationEntry) => html`
                      <tr>
                        <td>${item.day}</td>
                        <td>${item.date}</td>
                        <td>${item.time}</td>
                        <td>${item.amount}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            </div>

            <div class="historical-trends">
              <h2>Historical Trends</h2>
              <div class="chart-controls">
                <div class="control-group">
                  <label for="time-range">Time Range</label>
                  <select id="time-range" value=${timeRange} onChange=${handleTimeRangeChange}>
                    <option value="4weeks">Last 4 Weeks</option>
                    <option value="6months">Last 6 Months</option>
                    <option value="12months">Last Year</option>
                  </select>
                </div>
                <div class="control-group">
                  <label>Visible Metrics</label>
                  <div class="checkbox-group">
                    <div class="checkbox-wrapper">
                      <input type="checkbox" id="temp-toggle" name="temp" checked=${visibleCharts.temp} onChange=${handleChartVisibilityChange} />
                      <label for="temp-toggle">Temperature</label>
                    </div>
                    <div class="checkbox-wrapper">
                      <input type="checkbox" id="humidity-toggle" name="humidity" checked=${visibleCharts.humidity} onChange=${handleChartVisibilityChange} />
                      <label for="humidity-toggle">Humidity</label>
                    </div>
                    <div class="checkbox-wrapper">
                      <input type="checkbox" id="irrigation-toggle" name="irrigation" checked=${visibleCharts.irrigation} onChange=${handleChartVisibilityChange} />
                      <label for="irrigation-toggle">Irrigation</label>
                    </div>
                    <div class="checkbox-wrapper">
                      <input type="checkbox" id="risk-toggle" name="risk" checked=${visibleCharts.risk} onChange=${handleChartVisibilityChange} />
                      <label for="risk-toggle">Drought Risk</label>
                    </div>
                  </div>
                </div>
              </div>
              <div class="charts-grid">
                ${visibleCharts.temp && html`
                  <div class="chart-container">
                    <h3>Weather Patterns (°C) <small>(Scroll to zoom, Ctrl+Drag to pan)</small></h3>
                    <${ChartWrapper} type='line' data=${weatherChartData} options=${weatherChartOptions} />
                  </div>
                `}
                ${visibleCharts.humidity && html`
                  <div class="chart-container">
                    <h3>Historical Humidity (%) <small>(Scroll to zoom, Ctrl+Drag to pan)</small></h3>
                    <${ChartWrapper} type='line' data=${humidityChartData} options=${humidityChartOptions} />
                  </div>
                `}
                ${visibleCharts.irrigation && html`
                  <div class="chart-container">
                    <h3>Irrigation History (mm) <small>(Scroll to zoom, Ctrl+Drag to pan)</small></h3>
                    <${ChartWrapper} type='bar' data=${irrigationChartData} options=${irrigationChartOptions} />
                  </div>
                `}
                ${visibleCharts.risk && html`
                  <div class="chart-container">
                    <h3>Drought Risk Trend <small>(Scroll to zoom, Ctrl+Drag to pan)</small></h3>
                    <${ChartWrapper} type='line' data=${riskChartData} options=${riskChartOptions} />
                  </div>
                `}
              </div>
            </div>
          `}
        </section>
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("root")!);