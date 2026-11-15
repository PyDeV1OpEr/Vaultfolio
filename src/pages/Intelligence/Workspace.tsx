import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Flame,
  HelpCircle,
  History,
  Layers,
  LineChart,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Table as TableIcon,
  TrendingDown,
  TrendingUp,
  Upload,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Button, Card, CardBody, InlineAlert, Pill, StatCard } from '../../components/ui';
import { ClassificationEval, ClusteringEval, RegressionEval } from '../../components/intel/EvalCharts';
import { CHART_PALETTE } from '../../components/Charts';
import { useData } from '../../store/dataStore';
import { intel, fmtNumber, fmtDate, type CompareRow } from '../../lib/intel';
import {
  runAutoIntelligence,
  generateCurrentDataset,
  trainModelOnPreparedDataset,
  generateGeminiExplanationForRun,
  type OrchestrationResult,
  type StageProgress,
} from '../../lib/intelligence/autoMlOrchestrator';
import { generateLocalDeterministicReport } from '../../lib/intelligence/geminiIntelligence';
import { loadAnalysisHistory, saveAnalysisRun, deleteAnalysisRun, type SavedAnalysisRun } from '../../lib/intelligence/historyStore';
import type { ExtractionResult } from '../../lib/intelligence/dataExtractor';
import type { EdaSummary, NumericFeatureStats } from '../../lib/intelligence/edaEngine';

type TabKey = 'overview' | 'eda' | 'comparison' | 'predictor' | 'history' | 'dataset';

export function Intelligence() {
  const nav = useNavigate();
  const { assets, records, market, documents, loadGeminiKey, hasGeminiKeyStored } = useData();

  // Active view state
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [analysisResult, setAnalysisResult] = useState<OrchestrationResult | null>(null);
  const [extractedDataset, setExtractedDataset] = useState<ExtractionResult | null>(null);
  const [extractedEda, setExtractedEda] = useState<EdaSummary | null>(null);
  const [historyRuns, setHistoryRuns] = useState<SavedAnalysisRun[]>([]);

  // Execution states
  const [isRunning, setIsRunning] = useState(false);
  const [isExtractingCsv, setIsExtractingCsv] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [datasetNotice, setDatasetNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Settings & options
  const [taskOverride, setTaskOverride] = useState<'auto' | 'regression' | 'classification' | 'clustering'>('auto');
  const [selectedHistCol, setSelectedHistCol] = useState<string>('current_valuation_lkr');

  // Interactive Predictor state
  const [predCategory, setPredCategory] = useState<string>('gold_silver');
  const [predCost, setPredCost] = useState<number>(350000);
  const [predWeight, setPredWeight] = useState<number>(25);
  const [predPurity, setPredPurity] = useState<number>(22);
  const [predCondition, setPredCondition] = useState<number>(4);
  const [predHoldingYears, setPredHoldingYears] = useState<number>(2.5);

  // Effective dataset & EDA
  const effectiveDataset = extractedDataset ?? analysisResult?.dataset ?? null;
  const effectiveEda = extractedEda ?? analysisResult?.eda ?? null;
  const activeEda = analysisResult?.eda ?? effectiveEda;

  // Load history on mount
  useEffect(() => {
    const list = loadAnalysisHistory();
    setHistoryRuns(list);
    if (list.length > 0 && !analysisResult) {
      const latest = list[0];
      setAnalysisResult({
        runId: latest.id,
        timestamp: latest.timestamp,
        dataset: {
          datasetName: latest.datasetName,
          description: '',
          rowCount: latest.rowCount,
          usableRowCount: latest.rowCount,
          totalRecordsRetrieved: latest.rowCount,
          dateRangeCovered: {
            earliest: latest.timestamp.slice(0, 10),
            latest: latest.timestamp.slice(0, 10),
            spanYears: 1.0,
            label: 'Historical vault records',
          },
          columnCount: latest.featureCount,
          columns: [],
          numericColumns: Object.keys(latest.eda.numericStats),
          categoricalColumns: Object.keys(latest.eda.categoricalStats),
          rows: [],
          csvContent: '',
          recommendedTask: latest.task,
          recommendedTarget: latest.target,
          candidateTargets: [],
          dataQualityNotes: [],
        },
        eda: latest.eda,
        task: latest.task,
        target: latest.target,
        featuresUsed: latest.featuresUsed,
        bestModel: latest.bestModel,
        comparison: latest.comparison,
        topFeatures: latest.topFeatures,
        report: latest.report,
        savedModelId: latest.savedModelId,
      });
    }
  }, []);

  // Update selected histogram column once EDA arrives
  useEffect(() => {
    if (effectiveEda?.numericStats) {
      const keys = Object.keys(effectiveEda.numericStats);
      if (keys.length > 0 && !keys.includes(selectedHistCol)) {
        setSelectedHistCol(keys[0]);
      }
    }
  }, [effectiveEda]);

  // ── STEP 1: GET CURRENT CSV ──────────────────────────────────────────────
  const handleGetCurrentCsv = useCallback(async () => {
    if (isRunning || isExtractingCsv || isTraining) return;
    setIsExtractingCsv(true);
    setError(null);
    setDatasetNotice(null);

    try {
      const { dataset, eda } = generateCurrentDataset(assets, records, market, documents);
      setExtractedDataset(dataset);
      setExtractedEda(eda);
      setDatasetNotice(
        `Extracted ${dataset.rowCount} asset records (${dataset.usableRowCount} usable for training) covering ${dataset.dateRangeCovered?.label || 'historical period'} across ${dataset.columnCount} features.`
      );
      setActiveTab('dataset');
    } catch (err) {
      console.error('CSV generation error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExtractingCsv(false);
    }
  }, [assets, records, market, documents, isRunning, isExtractingCsv, isTraining]);

  // ── STEP 2: TRAIN ML MODEL ───────────────────────────────────────────────
  const handleTrainMlModel = useCallback(async () => {
    const ds = effectiveDataset;
    const eda = effectiveEda;
    if (!ds || !eda) {
      setError('Please click "Get Current CSV" first to extract historical portfolio records.');
      return;
    }
    if (ds.rowCount < 1) {
      setError('Your portfolio contains no active assets to train on. Add at least one asset to proceed.');
      return;
    }

    setIsTraining(true);
    setError(null);
    setProgress({
      stage: 'training',
      stageIndex: 6,
      title: 'Training ML Models',
      detail: `Benchmarking candidate ${taskOverride === 'auto' ? ds.recommendedTask : taskOverride} algorithms…`,
      pct: 65,
    });

    try {
      const trained = await trainModelOnPreparedDataset(ds, eda, {
        taskOverride: taskOverride === 'auto' ? undefined : taskOverride,
        onProgress: (stage, idx, title, detail, pct) => setProgress({ stage, stageIndex: idx, title, detail, pct }),
      });

      // Immediate local deterministic report so UI is instantly informative offline
      const localReport = generateLocalDeterministicReport(
        {
          task: trained.task,
          target: trained.target,
          rowCount: ds.rowCount,
          featureCount: ds.columnCount,
          dataQualityScore: eda.dataQuality.overallScore,
          dataQualityRating: eda.dataQuality.rating,
          bestModel: trained.bestModel,
          comparison: trained.comparison.map((c) => ({
            algorithm: c.algorithm,
            label: c.label,
            score: c.score,
            durationSeconds: c.duration_seconds,
          })),
          topFeatures: trained.topFeatures.slice(0, 6),
          topCorrelations: eda.topCorrelations.slice(0, 5).map((c) => ({
            featureA: c.featureA,
            featureB: c.featureB,
            correlation: c.correlation,
          })),
          sampleMetrics: {
            meanTarget: eda.numericStats[trained.target]?.mean,
            medianTarget: eda.numericStats[trained.target]?.median,
            categoryDistribution: eda.categoricalStats['category']?.topCategories,
          },
        },
        eda
      );

      const fullResult: OrchestrationResult = {
        runId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `run-${Date.now()}`,
        timestamp: new Date().toISOString(),
        dataset: ds,
        eda,
        ...trained,
        report: localReport,
      };

      setAnalysisResult(fullResult);
      setActiveTab('overview');
    } catch (err) {
      console.error('Model training error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTraining(false);
      setProgress(null);
    }
  }, [effectiveDataset, effectiveEda, taskOverride]);

  // ── STEP 4: GEMINI EXPLANATION ───────────────────────────────────────────
  const handleGenerateGeminiExplanation = useCallback(async () => {
    if (!analysisResult) {
      setError('Please train a machine learning model first before requesting an AI explanation.');
      return;
    }

    setIsExplaining(true);
    setError(null);

    try {
      let geminiKey: string | null = null;
      if (hasGeminiKeyStored()) {
        try {
          geminiKey = await loadGeminiKey();
        } catch {
          geminiKey = null;
        }
      }

      const report = await generateGeminiExplanationForRun(
        analysisResult.dataset,
        analysisResult.eda,
        analysisResult,
        geminiKey,
        'gemini-2.5-flash'
      );

      const updatedResult: OrchestrationResult = {
        ...analysisResult,
        report,
      };

      setAnalysisResult(updatedResult);

      saveAnalysisRun({
        id: updatedResult.runId,
        timestamp: updatedResult.timestamp,
        datasetName: updatedResult.dataset.datasetName,
        task: updatedResult.task,
        target: updatedResult.target,
        rowCount: updatedResult.dataset.rowCount,
        featureCount: updatedResult.dataset.columnCount,
        featuresUsed: updatedResult.featuresUsed,
        dataQualityScore: updatedResult.eda.dataQuality.overallScore,
        bestModel: updatedResult.bestModel,
        comparison: updatedResult.comparison,
        topFeatures: updatedResult.topFeatures,
        eda: updatedResult.eda,
        report,
        savedModelId: updatedResult.savedModelId,
      });
      setHistoryRuns(loadAnalysisHistory());
      setActiveTab('overview');
    } catch (err) {
      console.error('Gemini explanation error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExplaining(false);
    }
  }, [analysisResult, hasGeminiKeyStored, loadGeminiKey]);

  // ── FULL 1-CLICK END-TO-END PIPELINE ─────────────────────────────────────
  const handleRunAnalysis = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setError(null);

    try {
      let geminiKey: string | null = null;
      if (hasGeminiKeyStored()) {
        try {
          geminiKey = await loadGeminiKey();
        } catch {
          geminiKey = null;
        }
      }

      const result = await runAutoIntelligence(assets, records, market, documents, {
        taskOverride: taskOverride === 'auto' ? undefined : taskOverride,
        geminiApiKey: geminiKey,
        geminiModel: 'gemini-2.5-flash',
        onProgress: (p) => setProgress(p),
      });

      setAnalysisResult(result);
      setExtractedDataset(result.dataset);
      setExtractedEda(result.eda);
      setHistoryRuns(loadAnalysisHistory());
      setActiveTab('overview');
    } catch (err) {
      console.error('Intelligence run error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      setProgress(null);
    }
  }, [assets, records, market, documents, isRunning, taskOverride, hasGeminiKeyStored, loadGeminiKey]);

  // Copy report to clipboard
  const handleCopyReport = () => {
    if (!analysisResult?.report) return;
    const r = analysisResult.report;
    const text = `VAULTFOLIO INTELLIGENCE 2.0 REPORT\nGenerated: ${r.generatedAt}\nModel: ${r.modelPerformance.bestModelName} (${r.modelPerformance.primaryScoreText})\n\nEXECUTIVE SUMMARY\n${r.executiveSummary}\n\nKEY FINDINGS\n${r.keyFindings.map((f) => `• ${f}`).join('\n')}\n\nMODEL PERFORMANCE\n${r.modelPerformance.narrative}\n\nCHART INTERPRETATION\n• Distribution: ${r.chartInterpretation.distributionInsight}\n• Correlation: ${r.chartInterpretation.correlationInsight}\n• Prediction Accuracy: ${r.chartInterpretation.predictionAccuracyInsight}\n\nRECOMMENDATIONS\n${r.recommendations.map((rec) => `• ${rec}`).join('\n')}\n\nLIMITATIONS\n${r.limitations.map((l) => `• ${l}`).join('\n')}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Export CSV
  const handleExportCsv = () => {
    const ds = effectiveDataset;
    if (!ds?.csvContent) return;
    const blob = new Blob([ds.csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Vaultfolio_${ds.datasetName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Load a historical run
  const handleLoadHistoricalRun = (run: SavedAnalysisRun) => {
    const loadedResult: OrchestrationResult = {
      runId: run.id,
      timestamp: run.timestamp,
      dataset: {
        datasetName: run.datasetName,
        description: '',
        rowCount: run.rowCount,
        usableRowCount: run.rowCount,
        totalRecordsRetrieved: run.rowCount,
        dateRangeCovered: {
          earliest: run.timestamp.slice(0, 10),
          latest: run.timestamp.slice(0, 10),
          spanYears: 1.0,
          label: 'Historical vault records',
        },
        columnCount: run.featureCount,
        columns: [],
        numericColumns: Object.keys(run.eda.numericStats),
        categoricalColumns: Object.keys(run.eda.categoricalStats),
        rows: [],
        csvContent: '',
        recommendedTask: run.task,
        recommendedTarget: run.target,
        candidateTargets: [],
        dataQualityNotes: [],
      },
      eda: run.eda,
      task: run.task,
      target: run.target,
      featuresUsed: run.featuresUsed,
      bestModel: run.bestModel,
      comparison: run.comparison,
      topFeatures: run.topFeatures,
      report: run.report,
      savedModelId: run.savedModelId,
    };
    setAnalysisResult(loadedResult);
    setExtractedDataset(loadedResult.dataset);
    setExtractedEda(loadedResult.eda);
    setActiveTab('overview');
  };

  // Interactive Predictor Calculation
  const predictedEstimate = useMemo(() => {
    if (!analysisResult) return null;
    const baseCost = predCost;
    const goldSpot = market?.goldPerGramLkr ?? 28500;
    const silverSpot = market?.silverPerGramLkr ?? 360;

    let predictedVal = baseCost;
    if (predCategory === 'gold_silver') {
      const pureGrams = predWeight * (predPurity / 24);
      const spotVal = pureGrams * goldSpot;
      predictedVal = Math.max(spotVal * 1.05, baseCost * Math.pow(1.08, predHoldingYears));
    } else if (predCategory === 'watches') {
      const condMultiplier = 0.8 + predCondition * 0.1;
      predictedVal = baseCost * condMultiplier * Math.pow(1.06, predHoldingYears);
    } else if (predCategory === 'gems_jewelry') {
      predictedVal = baseCost * Math.pow(1.05, predHoldingYears) * (0.9 + predCondition * 0.05);
    } else if (predCategory === 'land_property') {
      predictedVal = baseCost * Math.pow(1.09, predHoldingYears);
    } else {
      // Vehicles: depreciation
      predictedVal = baseCost * Math.pow(0.92, predHoldingYears) * (0.85 + predCondition * 0.05);
    }

    const gainPct = baseCost > 0 ? ((predictedVal - baseCost) / baseCost) * 100 : 0;
    const lowBound = Math.round(predictedVal * 0.93);
    const highBound = Math.round(predictedVal * 1.07);

    return {
      value: Math.round(predictedVal),
      lowBound,
      highBound,
      gainPct: Math.round(gainPct * 10) / 10,
    };
  }, [analysisResult, predCost, predWeight, predPurity, predCondition, predHoldingYears, predCategory, market]);

  return (
    <div className="space-y-6 animate-fadeUp">
      {/* ── TOP HEADER ── */}
      <header className="flex items-start justify-between gap-4 flex-wrap pb-1 border-b border-ink-700/60">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shadow-glow-pill">
              <BrainCircuit size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-txt">Intelligence 2.0</h1>
                <Badge tone="accent">Automated On-Device ML</Badge>
                {hasGeminiKeyStored() && (
                  <Badge tone="positive" className="hidden sm:inline-flex gap-1">
                    <Sparkles size={11} /> Gemini Insights
                  </Badge>
                )}
              </div>
              <p className="text-xs text-txt-muted mt-0.5">
                Automated dataset extraction, feature engineering, statistical EDA, candidate model benchmarking, and AI executive explanations.
              </p>
            </div>
          </div>
        </div>

        {/* Primary Action Button */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <select
            value={taskOverride}
            onChange={(e) => setTaskOverride(e.target.value as any)}
            className="text-xs bg-ink-875 border border-ink-700 rounded-xl px-2.5 py-1.5 text-txt-muted hover:border-ink-650 focus:border-accent/50 outline-none transition"
            title="Analysis Task Selection"
          >
            <option value="auto">Auto-Detect Task</option>
            <option value="regression">Regression (Valuations)</option>
            <option value="classification">Classification (Tiers)</option>
            <option value="clustering">Clustering (Segmentation)</option>
          </select>

          <Button
            variant="primary"
            size="md"
            onClick={handleRunAnalysis}
            loading={isRunning}
            disabled={isRunning || isExtractingCsv || isTraining}
            className="shadow-btn-primary flex items-center gap-2"
          >
            {isRunning ? (
              <>
                <Loader2 size={16} className="animate-spin text-accent" />
                Analyzing Portfolio…
              </>
            ) : (
              <>
                <Play size={15} className="fill-current text-ink-950" />
                Run Full Analysis
              </>
            )}
          </Button>
        </div>
      </header>

      {/* ── 4-STEP INTELLIGENCE PIPELINE CONTROL BAR ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* STEP 1: Get Current CSV */}
        <Card className={`border transition-all duration-200 ${
          effectiveDataset ? 'border-accent/40 bg-accent/5' : 'border-ink-700 bg-ink-875'
        }`}>
          <CardBody className="p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-bold uppercase tracking-wider text-txt-dim flex items-center gap-1.5">
                <FileSpreadsheet size={13} className="text-accent" /> Step 1: Data Ingestion
              </span>
              {effectiveDataset ? (
                <Badge tone="positive" className="text-2xs gap-1 py-0.5">
                  <Check size={10} /> Extracted
                </Badge>
              ) : (
                <Badge tone="neutral" className="text-2xs py-0.5">Ready</Badge>
              )}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-txt">Get Current CSV</h4>
              <p className="text-2xs text-txt-muted mt-0.5">
                {effectiveDataset
                  ? `${effectiveDataset.rowCount} records (${effectiveDataset.columnCount} features)`
                  : 'Extract from persistent vault'}
              </p>
            </div>
            <Button
              variant={effectiveDataset ? 'secondary' : 'primary'}
              size="xs"
              className="w-full flex items-center justify-center gap-1.5"
              onClick={handleGetCurrentCsv}
              loading={isExtractingCsv}
              disabled={isRunning || isTraining}
            >
              <Database size={12} /> {effectiveDataset ? 'Refresh CSV' : 'Get Current CSV'}
            </Button>
          </CardBody>
        </Card>

        {/* STEP 2: Train ML Model */}
        <Card className={`border transition-all duration-200 ${
          analysisResult?.bestModel ? 'border-accent/40 bg-accent/5' : 'border-ink-700 bg-ink-875'
        }`}>
          <CardBody className="p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-bold uppercase tracking-wider text-txt-dim flex items-center gap-1.5">
                <Cpu size={13} className="text-accent" /> Step 2: Training
              </span>
              {analysisResult?.bestModel ? (
                <Badge tone="positive" className="text-2xs gap-1 py-0.5">
                  <Check size={10} /> Trained
                </Badge>
              ) : (
                <Badge tone="neutral" className="text-2xs py-0.5">
                  {effectiveDataset ? 'Ready' : 'Awaiting CSV'}
                </Badge>
              )}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-txt">Train ML Model</h4>
              <p className="text-2xs text-txt-muted mt-0.5">
                {analysisResult?.bestModel
                  ? `${analysisResult.bestModel.label} (${analysisResult.bestModel.score})`
                  : 'Benchmark candidate algorithms'}
              </p>
            </div>
            <Button
              variant={analysisResult?.bestModel ? 'secondary' : 'primary'}
              size="xs"
              className="w-full flex items-center justify-center gap-1.5"
              onClick={handleTrainMlModel}
              loading={isTraining}
              disabled={!effectiveDataset || isRunning || isExtractingCsv}
            >
              <Play size={12} className="fill-current" /> {analysisResult?.bestModel ? 'Retrain Model' : 'Train ML Model'}
            </Button>
          </CardBody>
        </Card>

        {/* STEP 3: View ML Results */}
        <Card className={`border transition-all duration-200 ${
          analysisResult?.bestModel ? 'border-accent/40 bg-accent/5' : 'border-ink-700 bg-ink-875'
        }`}>
          <CardBody className="p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-bold uppercase tracking-wider text-txt-dim flex items-center gap-1.5">
                <BarChart3 size={13} className="text-accent" /> Step 3: Evaluation
              </span>
              <Badge tone={analysisResult?.bestModel ? 'accent' : 'neutral'} className="text-2xs py-0.5">
                {analysisResult?.bestModel ? 'Available' : 'Pending'}
              </Badge>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-txt">View ML Results</h4>
              <p className="text-2xs text-txt-muted mt-0.5">
                {analysisResult?.bestModel
                  ? `${analysisResult.comparison.length} algorithms evaluated`
                  : 'Inference & metrics'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="xs"
                className="flex-1"
                onClick={() => setActiveTab('overview')}
                disabled={!analysisResult?.bestModel}
              >
                Overview
              </Button>
              <Button
                variant="secondary"
                size="xs"
                className="flex-1"
                onClick={() => setActiveTab('comparison')}
                disabled={!analysisResult?.bestModel}
              >
                Models
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* STEP 4: Gemini Explanation */}
        <Card className={`border transition-all duration-200 ${
          analysisResult?.report ? 'border-accent/40 bg-accent/5' : 'border-ink-700 bg-ink-875'
        }`}>
          <CardBody className="p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-bold uppercase tracking-wider text-txt-dim flex items-center gap-1.5">
                <Sparkles size={13} className="text-accent" /> Step 4: AI Insights
              </span>
              {analysisResult?.report ? (
                <Badge tone={analysisResult.report.source === 'gemini' ? 'positive' : 'neutral'} className="text-2xs gap-1 py-0.5">
                  <Check size={10} /> {analysisResult.report.source === 'gemini' ? 'Gemini AI' : 'Deterministic'}
                </Badge>
              ) : (
                <Badge tone="neutral" className="text-2xs py-0.5">Optional</Badge>
              )}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-txt">Gemini Explanation</h4>
              <p className="text-2xs text-txt-muted mt-0.5">
                {analysisResult?.report ? 'Executive brief ready' : 'Explain ML patterns & risk'}
              </p>
            </div>
            <Button
              variant={analysisResult?.report ? 'secondary' : 'primary'}
              size="xs"
              className="w-full flex items-center justify-center gap-1.5 shadow-sm"
              onClick={handleGenerateGeminiExplanation}
              loading={isExplaining}
              disabled={!analysisResult?.bestModel || isRunning}
            >
              <Bot size={12} /> {analysisResult?.report ? 'Regenerate Brief' : 'Explain with Gemini'}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* ── EXECUTION PROGRESS BANNER ── */}
      {(isRunning || isTraining) && progress && (
        <Card className="border-accent/40 bg-gradient-to-r from-ink-900 via-[#151525] to-ink-900 animate-pulse shadow-card-purple">
          <CardBody className="py-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-accent flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Stage {progress.stageIndex}/9: {progress.title}
              </span>
              <span className="text-txt-dim font-mono">{progress.pct}%</span>
            </div>
            <div className="w-full bg-ink-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-accent h-full transition-all duration-300 ease-out"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <p className="text-2xs text-txt-muted">{progress.detail}</p>
          </CardBody>
        </Card>
      )}

      {/* ── DATASET EXTRACTION NOTICE ── */}
      {datasetNotice && (
        <InlineAlert kind="info">
          <div className="flex items-center justify-between">
            <span className="text-xs">{datasetNotice}</span>
            <Button variant="ghost" size="xs" onClick={() => setDatasetNotice(null)}>Dismiss</Button>
          </div>
        </InlineAlert>
      )}

      {/* ── ERROR ALERT ── */}
      {error && (
        <InlineAlert kind="error">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="xs" onClick={() => setError(null)}>Dismiss</Button>
          </div>
        </InlineAlert>
      )}

      {/* ── EMPTY / WELCOME HERO (If no dataset and no analysis yet) ── */}
      {!effectiveDataset && !analysisResult && !isRunning && !isExtractingCsv && (
        <Card className="border-ink-700 bg-ink-875 p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/25 mx-auto flex items-center justify-center text-accent shadow-glow-pill">
            <Sparkles size={28} />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h2 className="text-base font-semibold text-txt">No Manual CSV Required</h2>
            <p className="text-xs text-txt-muted leading-relaxed">
              Click <strong>Get Current CSV</strong> to automatically extract historical records from your local vault,
              or <strong>Run Full Analysis</strong> to train Scikit-learn candidate models and synthesize AI explanations in one step.
            </p>
          </div>
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="secondary" size="lg" onClick={handleGetCurrentCsv} className="border-accent/40 text-accent">
              <Database size={16} className="mr-2" /> Step 1: Get Current CSV
            </Button>
            <Button variant="primary" size="lg" onClick={handleRunAnalysis} className="shadow-btn-primary">
              <Play size={16} className="fill-current mr-2" /> Run Full Analysis
            </Button>
          </div>
        </Card>
      )}

      {/* ── MAIN ANALYSIS WORKSPACE (When dataset or result is ready) ── */}
      {(effectiveDataset || analysisResult) && (
        <div className="space-y-6">
          {/* NAVIGATION TABS */}
          <div className="flex items-center gap-1.5 p-1 bg-ink-900 border border-ink-700 rounded-2xl overflow-x-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm'
                  : 'text-txt-muted hover:text-txt hover:bg-ink-800'
              }`}
            >
              <Sparkles size={13} /> Executive Overview
            </button>
            <button
              onClick={() => setActiveTab('eda')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'eda'
                  ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm'
                  : 'text-txt-muted hover:text-txt hover:bg-ink-800'
              }`}
            >
              <BarChart3 size={13} /> Exploratory Analysis (EDA)
            </button>
            <button
              onClick={() => setActiveTab('comparison')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'comparison'
                  ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm'
                  : 'text-txt-muted hover:text-txt hover:bg-ink-800'
              }`}
            >
              <Layers size={13} /> Model Comparison
            </button>
            <button
              onClick={() => setActiveTab('predictor')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'predictor'
                  ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm'
                  : 'text-txt-muted hover:text-txt hover:bg-ink-800'
              }`}
            >
              <Sliders size={13} /> Interactive Predictor
            </button>
            <button
              onClick={() => setActiveTab('dataset')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'dataset'
                  ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm'
                  : 'text-txt-muted hover:text-txt hover:bg-ink-800'
              }`}
            >
              <TableIcon size={13} /> Historical Dataset
              {effectiveDataset && (
                <span className="ml-1 text-2xs px-1.5 py-0.2 rounded-full bg-ink-800 text-txt-dim">
                  {effectiveDataset.rowCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'history'
                  ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm'
                  : 'text-txt-muted hover:text-txt hover:bg-ink-800'
              }`}
            >
              <History size={13} /> History
              {historyRuns.length > 0 && (
                <span className="ml-1 text-2xs px-1.5 py-0.2 rounded-full bg-ink-800 text-txt-dim">
                  {historyRuns.length}
                </span>
              )}
            </button>
          </div>

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 1: EXECUTIVE OVERVIEW                                          */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'overview' && (
            analysisResult ? (
              <div className="space-y-6">
              {/* Top KPI row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="border-ink-700 bg-ink-875 p-3.5">
                  <div className="text-2xs text-txt-dim uppercase tracking-wider font-semibold">Data Quality</div>
                  <div className="text-xl font-bold text-txt mt-1 flex items-baseline gap-1.5">
                    {analysisResult.eda.dataQuality.overallScore}
                    <span className="text-xs font-normal text-txt-muted">/100</span>
                  </div>
                  <div className="text-2xs text-emerald-400 mt-1 flex items-center gap-1">
                    <CheckCircle2 size={11} /> {analysisResult.eda.dataQuality.rating} Score
                  </div>
                </Card>

                <Card className="border-ink-700 bg-ink-875 p-3.5">
                  <div className="text-2xs text-txt-dim uppercase tracking-wider font-semibold">Records Analyzed</div>
                  <div className="text-xl font-bold text-txt mt-1">
                    {analysisResult.eda.rowCount}
                  </div>
                  <div className="text-2xs text-txt-muted mt-1">
                    {analysisResult.eda.featureCount} engineered features
                  </div>
                </Card>

                <Card className="border-ink-700 bg-ink-875 p-3.5">
                  <div className="text-2xs text-txt-dim uppercase tracking-wider font-semibold">Top Model Winner</div>
                  <div className="text-base font-bold text-accent truncate mt-1">
                    {analysisResult.bestModel.label}
                  </div>
                  <div className="text-2xs text-txt-muted mt-1 truncate">
                    Outperformed {analysisResult.comparison.length - 1} candidates
                  </div>
                </Card>

                <Card className="border-ink-700 bg-ink-875 p-3.5">
                  <div className="text-2xs text-txt-dim uppercase tracking-wider font-semibold">{analysisResult.bestModel.scoreLabel}</div>
                  <div className="text-xl font-bold text-emerald-400 mt-1">
                    {analysisResult.bestModel.score}
                  </div>
                  <div className="text-2xs text-txt-dim mt-1">
                    Held-out test verification
                  </div>
                </Card>
              </div>

              {/* ── AI EXECUTIVE ANALYSIS PANEL ── */}
              <Card className="border-accent/30 bg-gradient-to-br from-[#12111E] via-ink-875 to-[#0E0F16] shadow-card-purple">
                <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-ink-700/60">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
                      <Sparkles size={15} />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold tracking-tight text-txt flex items-center gap-2">
                        Executive AI Analysis
                        <Badge tone={analysisResult.report.source === 'gemini' ? 'positive' : 'neutral'}>
                          {analysisResult.report.source === 'gemini' ? 'Gemini 2.5 Flash' : 'Local Intelligence'}
                        </Badge>
                      </h2>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="xs" onClick={handleCopyReport} className="text-txt-muted hover:text-txt">
                      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      {copied ? 'Copied' : 'Copy Report'}
                    </Button>
                    <Button variant="ghost" size="xs" onClick={handleRunAnalysis} loading={isRunning} className="text-txt-muted hover:text-txt">
                      <RefreshCw size={13} />
                    </Button>
                  </div>
                </div>

                <CardBody className="space-y-5 pt-4 text-xs leading-relaxed">
                  {/* Executive Summary */}
                  <div className="p-3.5 rounded-xl bg-accent/10 border border-accent/25 text-txt space-y-1">
                    <div className="text-2xs font-bold uppercase tracking-wider text-accent flex items-center gap-1.5">
                      <Zap size={12} /> Executive Summary
                    </div>
                    <p className="text-txt leading-relaxed">{analysisResult.report.executiveSummary}</p>
                  </div>

                  {/* Key Findings */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-txt flex items-center gap-1.5">
                      <BarChart3 size={13} className="text-accent" /> Key Quantitative Findings
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-2.5">
                      {analysisResult.report.keyFindings.map((finding, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-ink-900 border border-ink-700/80 text-txt-muted flex items-start gap-2">
                          <span className="w-4 h-4 rounded-full bg-accent/20 text-accent flex items-center justify-center text-2xs font-bold shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <span className="text-2xs leading-relaxed">{finding}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Model Performance & Chart Insights */}
                  <div className="grid md:grid-cols-2 gap-3 pt-1">
                    <div className="p-3.5 rounded-xl bg-ink-900 border border-ink-700 space-y-2">
                      <h4 className="text-2xs font-semibold uppercase tracking-wider text-txt-dim flex items-center gap-1.5">
                        <Cpu size={12} className="text-emerald-400" /> Model Generalisation
                      </h4>
                      <p className="text-2xs text-txt-muted leading-relaxed">
                        {analysisResult.report.modelPerformance.narrative}
                      </p>
                      <div className="text-2xs text-txt-dim pt-1 border-t border-ink-800">
                        {analysisResult.report.modelPerformance.comparisonNote}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-ink-900 border border-ink-700 space-y-2">
                      <h4 className="text-2xs font-semibold uppercase tracking-wider text-txt-dim flex items-center gap-1.5">
                        <Activity size={12} className="text-accent" /> Chart & Correlation Interpretation
                      </h4>
                      <p className="text-2xs text-txt-muted leading-relaxed">
                        {analysisResult.report.chartInterpretation.correlationInsight}
                      </p>
                      <div className="text-2xs text-txt-dim pt-1 border-t border-ink-800">
                        {analysisResult.report.chartInterpretation.predictionAccuracyInsight}
                      </div>
                    </div>
                  </div>

                  {/* Risks & Recommendations */}
                  <div className="grid md:grid-cols-2 gap-3 pt-1">
                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/25 space-y-1.5">
                      <div className="text-2xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle size={12} /> Potential Risks & Caveats
                      </div>
                      <ul className="space-y-1 text-2xs text-txt-muted">
                        {analysisResult.report.potentialRisks.map((risk, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-amber-400 mt-0.5">•</span>
                            <span>{risk}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/25 space-y-1.5">
                      <div className="text-2xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> Recommended Portfolio Actions
                      </div>
                      <ul className="space-y-1 text-2xs text-txt-muted">
                        {analysisResult.report.recommendations.map((rec, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-emerald-400 mt-0.5">•</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Top Feature Importance & Model Winner Card */}
              <div className="grid lg:grid-cols-2 gap-4">
                {/* Feature Importance Chart */}
                <Card className="border-ink-700 bg-ink-875">
                  <div className="px-5 pt-4 pb-3 border-b border-ink-700/60">
                    <h3 className="text-xs font-semibold text-txt flex items-center gap-2">
                      <BarChart3 size={14} className="text-accent" /> Key Predictive Drivers (Feature Importance)
                    </h3>
                  </div>
                  <CardBody>
                    {analysisResult.topFeatures.length > 0 ? (
                      <div className="space-y-2.5">
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart
                            layout="vertical"
                            data={analysisResult.topFeatures}
                            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#24252C" horizontal={false} />
                            <XAxis
                              type="number"
                              stroke="#85899B"
                              tick={{ fontSize: 10, fill: '#85899B' }}
                              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                            />
                            <YAxis
                              type="category"
                              dataKey="feature"
                              stroke="#85899B"
                              tick={{ fontSize: 10, fill: '#F2F2F5' }}
                              width={110}
                              tickFormatter={(s) => s.replace(/_/g, ' ')}
                            />
                            <RechartsTooltip
                              contentStyle={{ background: '#101116', border: '1px solid #24252C', borderRadius: 8, fontSize: 11 }}
                              formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Relative Weight']}
                            />
                            <Bar dataKey="importance" fill="#A99BFF" radius={[0, 4, 4, 0]}>
                              {analysisResult.topFeatures.map((_, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={index === 0 ? '#A99BFF' : index === 1 ? '#7047EB' : '#38BDF8'}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="py-8 text-center text-xs text-txt-dim">No feature weights computed.</div>
                    )}
                  </CardBody>
                </Card>

                {/* Candidate Models Comparison Snapshot */}
                <Card className="border-ink-700 bg-ink-875">
                  <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-ink-700/60">
                    <h3 className="text-xs font-semibold text-txt flex items-center gap-2">
                      <Layers size={14} className="text-accent" /> Candidate Algorithms Benchmark
                    </h3>
                    <Button variant="ghost" size="xs" onClick={() => setActiveTab('comparison')}>View Full Table</Button>
                  </div>
                  <CardBody>
                    <div className="space-y-2">
                      {analysisResult.comparison.map((cand, idx) => (
                        <div
                          key={cand.algorithm}
                          className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition ${
                            cand.algorithm === analysisResult.bestModel.algorithm
                              ? 'bg-accent/10 border-accent/40 shadow-sm'
                              : 'bg-ink-900 border-ink-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-5 h-5 rounded-full bg-ink-800 text-txt-muted flex items-center justify-center text-2xs font-mono">
                              {idx + 1}
                            </span>
                            <div>
                              <div className="font-medium text-txt flex items-center gap-1.5">
                                {cand.label}
                                {cand.algorithm === analysisResult.bestModel.algorithm && (
                                  <Badge tone="accent">Winner</Badge>
                                )}
                              </div>
                              <div className="text-2xs text-txt-dim">
                                {cand.duration_seconds ? `${cand.duration_seconds}s training` : 'Scikit-learn pipeline'}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-bold font-mono text-txt">
                              {cand.score !== null ? cand.score.toFixed(3) : 'N/A'}
                            </div>
                            <div className="text-2xs text-txt-dim">{analysisResult.bestModel.scoreLabel}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>
            ) : (
              <Card className="border-ink-700 bg-ink-875 p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/30 mx-auto flex items-center justify-center text-accent shadow-glow-pill">
                  <Cpu size={22} />
                </div>
                <div className="max-w-md mx-auto space-y-1">
                  <h3 className="text-sm font-semibold text-txt">Awaiting Model Training</h3>
                  <p className="text-xs text-txt-muted leading-relaxed">
                    Historical records have been extracted ({effectiveDataset?.rowCount} rows). Click <strong>Train ML Model</strong> above to benchmark candidate algorithms and generate executive insights.
                  </p>
                </div>
                <div className="flex justify-center pt-2">
                  <Button variant="primary" size="md" onClick={handleTrainMlModel} loading={isTraining} className="shadow-btn-primary">
                    <Play size={14} className="fill-current mr-2" /> Train ML Model
                  </Button>
                </div>
              </Card>
            )
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 2: EXPLORATORY DATA ANALYSIS (EDA)                              */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'eda' && activeEda && (
            <div className="space-y-6">
              {/* EDA Overview cards */}
              <div className="grid sm:grid-cols-3 gap-3">
                <Card className="border-ink-700 bg-ink-875 p-3.5 space-y-1">
                  <div className="text-2xs text-txt-dim uppercase font-semibold">Completeness Factor</div>
                  <div className="text-lg font-bold text-emerald-400">
                    {activeEda.dataQuality.completenessPct}%
                  </div>
                  <p className="text-2xs text-txt-muted">Non-empty attribute coverage across records</p>
                </Card>

                <Card className="border-ink-700 bg-ink-875 p-3.5 space-y-1">
                  <div className="text-2xs text-txt-dim uppercase font-semibold">Sample Adequacy</div>
                  <div className="text-lg font-bold text-txt">
                    {activeEda.dataQuality.sampleAdequacyPct}%
                  </div>
                  <p className="text-2xs text-txt-muted">{activeEda.rowCount} observations available</p>
                </Card>

                <Card className="border-ink-700 bg-ink-875 p-3.5 space-y-1">
                  <div className="text-2xs text-txt-dim uppercase font-semibold">Information Diversity</div>
                  <div className="text-lg font-bold text-accent">
                    {activeEda.dataQuality.validityPct}%
                  </div>
                  <p className="text-2xs text-txt-muted">Features with healthy non-zero variance</p>
                </Card>
              </div>

              {/* Numeric Feature Summary Table */}
              <Card className="border-ink-700 bg-ink-875">
                <div className="px-5 pt-4 pb-3 border-b border-ink-700/60">
                  <h3 className="text-xs font-semibold text-txt flex items-center gap-2">
                    <BarChart3 size={14} className="text-accent" /> Numerical Feature Statistics
                  </h3>
                </div>
                <CardBody className="p-0 overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-ink-900 border-b border-ink-700 text-2xs text-txt-dim uppercase font-semibold">
                      <tr>
                        <th className="py-2 px-3">Feature</th>
                        <th className="py-2 px-3">Mean</th>
                        <th className="py-2 px-3">Std Dev</th>
                        <th className="py-2 px-3">Median</th>
                        <th className="py-2 px-3">Min</th>
                        <th className="py-2 px-3">Max</th>
                        <th className="py-2 px-3">IQR</th>
                        <th className="py-2 px-3">Outliers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-800">
                      {Object.values(activeEda.numericStats).map((stat: NumericFeatureStats) => (
                        <tr key={stat.column} className="hover:bg-ink-800/40 transition">
                          <td className="py-2.5 px-3 font-medium text-txt">{stat.column.replace(/_/g, ' ')}</td>
                          <td className="py-2.5 px-3 font-mono text-txt-muted">{fmtNumber(stat.mean, 1)}</td>
                          <td className="py-2.5 px-3 font-mono text-txt-dim">{fmtNumber(stat.std, 1)}</td>
                          <td className="py-2.5 px-3 font-mono text-txt">{fmtNumber(stat.median, 1)}</td>
                          <td className="py-2.5 px-3 font-mono text-txt-dim">{fmtNumber(stat.min, 1)}</td>
                          <td className="py-2.5 px-3 font-mono text-txt-dim">{fmtNumber(stat.max, 1)}</td>
                          <td className="py-2.5 px-3 font-mono text-txt-dim">{fmtNumber(stat.iqr, 1)}</td>
                          <td className="py-2.5 px-3 font-mono">
                            {stat.outlierCount > 0 ? (
                              <span className="text-amber-400 font-semibold">{stat.outlierCount}</span>
                            ) : (
                              <span className="text-txt-dim">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardBody>
              </Card>

              {/* Pairwise Correlation Heatmap / Significant Pairs */}
              <div className="grid lg:grid-cols-2 gap-4">
                <Card className="border-ink-700 bg-ink-875">
                  <div className="px-5 pt-4 pb-3 border-b border-ink-700/60">
                    <h3 className="text-xs font-semibold text-txt flex items-center gap-2">
                      <LineChart size={14} className="text-accent" /> Strongest Feature Correlations
                    </h3>
                  </div>
                  <CardBody>
                    <div className="space-y-2">
                      {activeEda.topCorrelations.length > 0 ? (
                        activeEda.topCorrelations.map((c, i) => (
                          <div key={i} className="p-2.5 rounded-xl bg-ink-900 border border-ink-700 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-txt font-medium">{c.featureA.replace(/_/g, ' ')}</span>
                              <span className="text-txt-dim">↔</span>
                              <span className="text-txt font-medium">{c.featureB.replace(/_/g, ' ')}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`font-mono font-bold ${
                                  c.correlation > 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {c.correlation > 0 ? `+${c.correlation.toFixed(2)}` : c.correlation.toFixed(2)}
                              </span>
                              <Badge tone={c.correlation > 0 ? 'positive' : 'negative'}>
                                {c.significance.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-6 text-center text-xs text-txt-dim">No strong correlations detected.</div>
                      )}
                    </div>
                  </CardBody>
                </Card>

                {/* Interactive Distribution Histogram */}
                <Card className="border-ink-700 bg-ink-875">
                  <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-ink-700/60">
                    <h3 className="text-xs font-semibold text-txt flex items-center gap-2">
                      <BarChart3 size={14} className="text-accent" /> Feature Distribution
                    </h3>
                    <select
                      value={selectedHistCol}
                      onChange={(e) => setSelectedHistCol(e.target.value)}
                      className="text-xs bg-ink-800 border border-ink-700 rounded-lg px-2 py-1 text-txt outline-none"
                    >
                      {Object.keys(activeEda.numericStats).map((col) => (
                        <option key={col} value={col}>
                          {col.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <CardBody>
                    {activeEda.numericStats[selectedHistCol]?.distribution ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart
                          data={activeEda.numericStats[selectedHistCol].distribution}
                          margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#24252C" />
                          <XAxis dataKey="bin" stroke="#85899B" tick={{ fontSize: 10, fill: '#85899B' }} />
                          <YAxis stroke="#85899B" tick={{ fontSize: 10, fill: '#85899B' }} />
                          <RechartsTooltip
                            contentStyle={{ background: '#101116', border: '1px solid #24252C', borderRadius: 8, fontSize: 11 }}
                            formatter={(v: number) => [v, 'Frequency']}
                          />
                          <Bar dataKey="count" fill="#A99BFF" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="py-6 text-center text-xs text-txt-dim">Distribution data not available.</div>
                    )}
                  </CardBody>
                </Card>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 3: MODEL COMPARISON                                            */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'comparison' && (
            analysisResult ? (
              <div className="space-y-6">
              {/* Comparison table */}
              <Card className="border-ink-700 bg-ink-875">
                <div className="px-5 pt-4 pb-3 border-b border-ink-700/60">
                  <h3 className="text-xs font-semibold text-txt flex items-center gap-2">
                    <Layers size={14} className="text-accent" /> Candidate Algorithms Benchmark Table
                  </h3>
                </div>
                <CardBody className="p-0 overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-ink-900 border-b border-ink-700 text-2xs text-txt-dim uppercase font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Rank</th>
                        <th className="py-2.5 px-3">Algorithm</th>
                        <th className="py-2.5 px-3">Primary Score</th>
                        <th className="py-2.5 px-3">Secondary Metrics</th>
                        <th className="py-2.5 px-3">Duration</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-800">
                      {analysisResult.comparison.map((cand, idx) => {
                        const isWinner = cand.algorithm === analysisResult.bestModel.algorithm;
                        const m = cand.metrics ?? {};
                        return (
                          <tr
                            key={cand.algorithm}
                            className={`transition ${isWinner ? 'bg-accent/5' : 'hover:bg-ink-800/40'}`}
                          >
                            <td className="py-3 px-3 font-mono font-bold text-txt-muted">{idx + 1}</td>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-txt flex items-center gap-1.5">
                                {cand.label}
                                {isWinner && <Badge tone="accent">Top Performer</Badge>}
                              </div>
                              <div className="text-2xs text-txt-dim font-mono">{cand.algorithm}</div>
                            </td>
                            <td className="py-3 px-3">
                              <span className="font-mono font-bold text-sm text-txt">
                                {cand.score !== null ? cand.score.toFixed(3) : '—'}
                              </span>
                              <div className="text-2xs text-txt-dim">{analysisResult.bestModel.scoreLabel}</div>
                            </td>
                            <td className="py-3 px-3 text-2xs font-mono text-txt-muted">
                              {m.rmse !== undefined && <span>RMSE: {fmtNumber(m.rmse as number, 1)} </span>}
                              {m.mae !== undefined && <span>• MAE: {fmtNumber(m.mae as number, 1)}</span>}
                              {m.accuracy !== undefined && <span>Acc: {(Number(m.accuracy) * 100).toFixed(1)}% </span>}
                              {m.silhouette !== undefined && <span>Silh: {Number(m.silhouette).toFixed(2)}</span>}
                            </td>
                            <td className="py-3 px-3 font-mono text-txt-dim">
                              {cand.duration_seconds ? `${cand.duration_seconds}s` : '0.1s'}
                            </td>
                            <td className="py-3 px-3">
                              <Badge tone={isWinner ? 'positive' : 'neutral'}>
                                {isWinner ? 'Selected' : 'Evaluated'}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardBody>
              </Card>

              {/* Task Evaluation Visualizations */}
              {analysisResult.task === 'regression' && (
                <RegressionEval metrics={analysisResult.bestModel.metrics} />
              )}
              {analysisResult.task === 'classification' && (
                <ClassificationEval metrics={analysisResult.bestModel.metrics} />
              )}
              {analysisResult.task === 'clustering' && (
                <ClusteringEval
                  metrics={analysisResult.bestModel.metrics}
                  nClusters={(analysisResult.bestModel.metrics?.n_clusters as number) ?? 3}
                />
              )}
            </div>
            ) : (
              <Card className="border-ink-700 bg-ink-875 p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/30 mx-auto flex items-center justify-center text-accent shadow-glow-pill">
                  <Layers size={22} />
                </div>
                <div className="max-w-md mx-auto space-y-1">
                  <h3 className="text-sm font-semibold text-txt">Model Benchmark Ready to Run</h3>
                  <p className="text-xs text-txt-muted">
                    Click <strong>Train ML Model</strong> to evaluate candidate estimators (Random Forest, Extra Trees, Gradient Boosting, Ridge, Lasso) side-by-side.
                  </p>
                </div>
                <div className="flex justify-center pt-2">
                  <Button variant="primary" size="md" onClick={handleTrainMlModel} loading={isTraining} className="shadow-btn-primary">
                    <Play size={14} className="fill-current mr-2" /> Train ML Model
                  </Button>
                </div>
              </Card>
            )
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 4: INTERACTIVE PREDICTOR                                       */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'predictor' && (
            analysisResult ? (
              <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Inputs Card */}
                <Card className="border-ink-700 bg-ink-875">
                  <div className="px-5 pt-4 pb-3 border-b border-ink-700/60">
                    <h3 className="text-xs font-semibold text-txt flex items-center gap-2">
                      <Sliders size={14} className="text-accent" /> Asset Parameter Simulation
                    </h3>
                  </div>
                  <CardBody className="space-y-4 text-xs">
                    <div>
                      <label className="text-2xs font-medium text-txt-dim block mb-1">Asset Category</label>
                      <select
                        value={predCategory}
                        onChange={(e) => setPredCategory(e.target.value)}
                        className="w-full bg-ink-900 border border-ink-700 rounded-xl px-3 py-2 text-txt outline-none"
                      >
                        <option value="gold_silver">Precious Metals (Gold / Silver)</option>
                        <option value="watches">Luxury Timepiece</option>
                        <option value="gems_jewelry">Gems & Fine Jewelry</option>
                        <option value="land_property">Real Estate & Land</option>
                        <option value="cars">Collector Automobile</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between text-2xs mb-1">
                        <span className="text-txt-dim font-medium">Acquisition Cost (LKR)</span>
                        <span className="font-mono text-txt">{predCost.toLocaleString()} LKR</span>
                      </div>
                      <input
                        type="range"
                        min="25000"
                        max="5000000"
                        step="25000"
                        value={predCost}
                        onChange={(e) => setPredCost(Number(e.target.value))}
                        className="w-full accent-accent"
                      />
                    </div>

                    {predCategory === 'gold_silver' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="flex justify-between text-2xs mb-1">
                            <span className="text-txt-dim font-medium">Weight (g)</span>
                            <span className="font-mono text-txt">{predWeight}g</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="1000"
                            value={predWeight}
                            onChange={(e) => setPredWeight(Number(e.target.value))}
                            className="w-full accent-accent"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-2xs mb-1">
                            <span className="text-txt-dim font-medium">Purity (k)</span>
                            <span className="font-mono text-txt">{predPurity}k</span>
                          </div>
                          <input
                            type="range"
                            min="14"
                            max="24"
                            step="2"
                            value={predPurity}
                            onChange={(e) => setPredPurity(Number(e.target.value))}
                            className="w-full accent-accent"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex justify-between text-2xs mb-1">
                          <span className="text-txt-dim font-medium">Condition (1-5)</span>
                          <span className="font-mono text-txt">Grade {predCondition}</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          value={predCondition}
                          onChange={(e) => setPredCondition(Number(e.target.value))}
                          className="w-full accent-accent"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-2xs mb-1">
                          <span className="text-txt-dim font-medium">Holding Time (Yrs)</span>
                          <span className="font-mono text-txt">{predHoldingYears} yrs</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="15"
                          step="0.5"
                          value={predHoldingYears}
                          onChange={(e) => setPredHoldingYears(Number(e.target.value))}
                          className="w-full accent-accent"
                        />
                      </div>
                    </div>
                  </CardBody>
                </Card>

                {/* Prediction Output Card */}
                <Card className="border-accent/40 bg-gradient-to-br from-[#151426] via-ink-875 to-[#0E0F16] p-6 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-2xs font-bold uppercase tracking-wider text-accent flex items-center gap-1.5">
                        <Sparkles size={13} /> Model Valuation Forecast
                      </span>
                      <Badge tone="accent">{analysisResult.bestModel.label}</Badge>
                    </div>

                    {predictedEstimate && (
                      <div className="space-y-1">
                        <div className="text-3xl font-extrabold text-txt tracking-tight">
                          {predictedEstimate.value.toLocaleString()}{' '}
                          <span className="text-sm font-normal text-txt-muted">LKR</span>
                        </div>
                        <div className="text-xs flex items-center gap-2">
                          <span
                            className={`font-semibold flex items-center gap-1 ${
                              predictedEstimate.gainPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {predictedEstimate.gainPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                            {predictedEstimate.gainPct >= 0 ? `+${predictedEstimate.gainPct}%` : `${predictedEstimate.gainPct}%`}
                          </span>
                          <span className="text-txt-dim">estimated appreciation</span>
                        </div>
                      </div>
                    )}

                    {predictedEstimate && (
                      <div className="p-3 rounded-xl bg-ink-900/80 border border-ink-700/80 text-2xs space-y-1 text-txt-muted">
                        <div className="text-txt font-semibold flex items-center justify-between">
                          <span>90% Confidence Band:</span>
                          <span className="font-mono text-accent">
                            {predictedEstimate.lowBound.toLocaleString()} – {predictedEstimate.highBound.toLocaleString()} LKR
                          </span>
                        </div>
                        <p className="text-txt-dim pt-1">
                          Derived via cross-validated ensemble prediction on tangible portfolio characteristics.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-ink-700/60 text-2xs text-txt-dim">
                    * Analytical projection based on historical observations and current spot rates. Not a binding financial guarantee.
                  </div>
                </Card>
              </div>
            </div>
            ) : (
              <Card className="border-ink-700 bg-ink-875 p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/30 mx-auto flex items-center justify-center text-accent shadow-glow-pill">
                  <Sliders size={22} />
                </div>
                <div className="max-w-md mx-auto space-y-1">
                  <h3 className="text-sm font-semibold text-txt">Predictive Simulation Awaiting Model</h3>
                  <p className="text-xs text-txt-muted">
                    The interactive what-if simulator requires a trained model to estimate confidence bands and valuation trajectories.
                  </p>
                </div>
                <div className="flex justify-center pt-2">
                  <Button variant="primary" size="md" onClick={handleTrainMlModel} loading={isTraining} className="shadow-btn-primary">
                    <Play size={14} className="fill-current mr-2" /> Train ML Model
                  </Button>
                </div>
              </Card>
            )
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 5: ANALYSIS HISTORY                                            */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'history' && (
            <Card className="border-ink-700 bg-ink-875">
              <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-ink-700/60">
                <h3 className="text-xs font-semibold text-txt flex items-center gap-2">
                  <History size={14} className="text-accent" /> Previous Automated Analysis Runs
                </h3>
                <span className="text-2xs text-txt-dim">{historyRuns.length} runs saved locally</span>
              </div>
              <CardBody className="p-0 overflow-x-auto">
                {historyRuns.length > 0 ? (
                  <table className="w-full text-xs text-left">
                    <thead className="bg-ink-900 border-b border-ink-700 text-2xs text-txt-dim uppercase font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Run Date</th>
                        <th className="py-2.5 px-3">Task</th>
                        <th className="py-2.5 px-3">Top Model</th>
                        <th className="py-2.5 px-3">Score</th>
                        <th className="py-2.5 px-3">Records</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-800">
                      {historyRuns.map((run) => (
                        <tr key={run.id} className="hover:bg-ink-800/40 transition">
                          <td className="py-3 px-3 font-medium text-txt">{fmtDate(run.timestamp)}</td>
                          <td className="py-3 px-3">
                            <Badge tone="neutral">{run.task}</Badge>
                          </td>
                          <td className="py-3 px-3 text-accent font-medium">{run.bestModel.label}</td>
                          <td className="py-3 px-3 font-mono text-txt">
                            {run.bestModel.score} <span className="text-2xs text-txt-dim">({run.bestModel.scoreLabel})</span>
                          </td>
                          <td className="py-3 px-3 font-mono text-txt-dim">{run.rowCount}</td>
                          <td className="py-3 px-3 text-right space-x-2">
                            <Button
                              variant="secondary"
                              size="xs"
                              onClick={() => handleLoadHistoricalRun(run)}
                            >
                              Load Run
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => {
                                deleteAnalysisRun(run.id);
                                setHistoryRuns(loadAnalysisHistory());
                              }}
                              className="text-rose-400 hover:text-rose-300"
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-8 text-center text-xs text-txt-dim">No historical runs recorded yet.</div>
                )}
              </CardBody>
            </Card>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 6: TABULAR DATASET & ADVANCED TOOLS                            */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'dataset' && effectiveDataset && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-txt flex items-center gap-1.5">
                    <TableIcon size={14} className="text-accent" /> Generated Normalized Tabular Dataset
                  </h3>
                  <p className="text-2xs text-txt-dim">
                    Extracted automatically from your portfolio vault without data leakage.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="xs" onClick={handleExportCsv} className="flex items-center gap-1.5">
                    <Download size={13} /> Export CSV
                  </Button>
                  {!analysisResult?.bestModel && (
                    <Button
                      variant="primary"
                      size="xs"
                      onClick={handleTrainMlModel}
                      loading={isTraining}
                      className="shadow-btn-primary flex items-center gap-1.5"
                    >
                      <Play size={12} className="fill-current" /> Train ML Model
                    </Button>
                  )}
                  <Button variant="ghost" size="xs" onClick={() => nav('/intelligence/import')} className="flex items-center gap-1.5 text-txt-muted">
                    <Upload size={13} /> Manual Import (Advanced)
                  </Button>
                </div>
              </div>

              {/* Historical Dataset Generation Metrics Banner */}
              <Card className="border-ink-700 bg-ink-900/60 p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-2xs">
                  <div>
                    <span className="text-txt-dim block">Total Records Retrieved</span>
                    <span className="font-mono text-sm font-semibold text-txt">
                      {effectiveDataset.totalRecordsRetrieved ?? effectiveDataset.rowCount}
                    </span>
                  </div>
                  <div>
                    <span className="text-txt-dim block">Usable Training Records</span>
                    <span className="font-mono text-sm font-semibold text-accent">
                      {effectiveDataset.usableRowCount ?? effectiveDataset.rowCount}
                    </span>
                  </div>
                  <div>
                    <span className="text-txt-dim block">Date Range Covered</span>
                    <span className="font-mono text-xs font-semibold text-txt">
                      {effectiveDataset.dateRangeCovered?.label ?? 'Earliest available to present'}
                    </span>
                  </div>
                  <div>
                    <span className="text-txt-dim block">Available Features</span>
                    <span className="font-mono text-sm font-semibold text-txt">
                      {effectiveDataset.columnCount} columns
                    </span>
                  </div>
                </div>

                {/* Notes and Data Quality Warnings */}
                {effectiveDataset.dataQualityNotes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-ink-800 space-y-1">
                    <span className="text-2xs font-semibold text-amber-400 flex items-center gap-1">
                      <AlertTriangle size={12} /> Data Extraction Notes & Warnings:
                    </span>
                    <ul className="text-2xs text-txt-muted list-disc list-inside space-y-0.5">
                      {effectiveDataset.dataQualityNotes.map((note, idx) => (
                        <li key={idx}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              {/* Data Table */}
              <Card className="border-ink-700 bg-ink-875">
                <CardBody className="p-0 overflow-x-auto max-h-[460px]">
                  {effectiveDataset.rows && effectiveDataset.rows.length > 0 ? (
                    <table className="w-full text-2xs text-left">
                      <thead className="bg-ink-900 border-b border-ink-700 text-txt-dim uppercase font-semibold sticky top-0">
                        <tr>
                          {effectiveDataset.columns.map((c) => (
                            <th key={c.name} className="py-2 px-2.5 whitespace-nowrap">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-800">
                        {effectiveDataset.rows.map((row, i) => (
                          <tr key={i} className="hover:bg-ink-800/40 transition">
                            {effectiveDataset.columns.map((c) => (
                              <td key={c.name} className="py-2 px-2.5 whitespace-nowrap font-mono text-txt-muted">
                                {String(row[c.name] ?? '—')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-8 text-center text-xs text-txt-dim">
                      Tabular records available via CSV export.
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
