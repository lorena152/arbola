export type VariableType = 'numeric' | 'categorical' | 'ignored';

export type DataValue = string | number | null;
export type DataRow = Record<string, DataValue>;

export interface ColumnSchema {
  name: string;
  detectedType: VariableType;
  type: VariableType;
  uniqueCount: number;
  missingCount: number;
  sampleValues: DataValue[];
}

export interface DatasetState {
  name: string;
  source: 'upload' | 'synthetic' | 'preset';
  sectorContext: string;
  rows: DataRow[];
  columns: ColumnSchema[];
  fileFormat?: string;
}

export interface NumericStats {
  column: string;
  count: number;
  missing: number;
  mean: number;
  std: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  skewness: number;
}

export interface CategoryBucket {
  value: string;
  count: number;
  percentage: number;
  byTarget?: Record<string, number>;
}

export interface CategoricalDistribution {
  column: string;
  totalValid: number;
  missing: number;
  uniqueCount: number;
  buckets: CategoryBucket[];
}

export interface TargetSuggestion {
  column: string;
  confidence: 'alta' | 'media' | 'baja';
  reason: string;
  recommendedPositiveClass?: string;
}

export interface TargetSuggestionResponse {
  suggestions: TargetSuggestion[];
  clarifyingQuestion: string;
  domainSummary: string;
}

export interface SplitResult {
  trainRows: DataRow[];
  testRows: DataRow[];
  trainRatio: number;
  stratified: boolean;
  seed: number;
  classBalance: {
    label: string;
    total: number;
    train: number;
    test: number;
  }[];
}

export type SplitCriterion = 'gini' | 'entropy';

export interface TreeHyperparams {
  criterion: SplitCriterion;
  maxDepth: number;
  minSamplesSplit: number;
  minSamplesLeaf: number;
  ccpAlpha: number;
}

export interface TreeSplitCondition {
  feature: string;
  featureType: 'numeric' | 'categorical';
  operator: '<=' | 'in';
  threshold?: number;
  leftCategories?: string[];
  rightCategories?: string[];
  labelLeft: string;
  labelRight: string;
}

export interface DecisionTreeNode {
  id: string;
  depth: number;
  samples: number;
  impurity: number;
  impurityGain: number;
  classCounts: Record<string, number>;
  prediction: string;
  confidence: number;
  isLeaf: boolean;
  manuallyPruned?: boolean;
  split?: TreeSplitCondition;
  left?: DecisionTreeNode;
  right?: DecisionTreeNode;
}

export interface TreeStats {
  totalNodes: number;
  leafCount: number;
  maxDepthReached: number;
  trainAccuracy: number;
  testAccuracy: number;
}

export interface TreeRule {
  leafId: string;
  conditions: string[];
  prediction: string;
  samples: number;
  confidence: number;
  supportPct: number;
  classCounts: Record<string, number>;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  splitsCount: number;
}

export interface PerClassMetrics {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  specificity: number;
  support: number;
}

export interface EvaluationMetrics {
  labels: string[];
  confusionMatrix: number[][];
  totalTest: number;
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  weightedF1: number;
  rocAuc: number | null;
  positiveClass: string;
  perClass: PerClassMetrics[];
  trainAccuracy: number;
}

export interface CcpAlphaOption {
  alpha: number;
  leafCount: number;
  cvAccuracy: number;
  cvF1: number;
  isRecommended?: boolean;
}

export interface TreeSnapshotMetrics {
  label: string;
  maxDepth: number;
  totalNodes: number;
  leafCount: number;
  trainAccuracy: number;
  trainF1: number;
  cvAccuracy: number;
  cvF1: number;
}

export interface ErrorImpactAnalysis {
  falsePositiveImpact: string;
  falseNegativeImpact: string;
  balanceRecommendation: string;
  priorityErrorType: 'FP' | 'FN' | 'Equilibrado';
}

export interface OptimizationSummary {
  bestParams: TreeHyperparams;
  cvAccuracy: number;
  candidatesTested: number;
}

export interface StrategySegment {
  segmentName: string;
  treeRule: string;
  predictedOutcome: string;
  volumeShare: string;
  marketingAngle: string;
  communicationChannel: string;
  keyMessage: string;
}

export interface BusinessStrategyReport {
  executiveSummary: string;
  modelTrustAssessment: string;
  segments: StrategySegment[];
  marketingStrategies: {
    title: string;
    objective: string;
    tactic: string;
    expectedImpact: string;
  }[];
  communicationPlan: {
    audience: string;
    toneAndNarrative: string;
    channels: string[];
    callToAction: string;
  }[];
  actionPlan: {
    horizon: string;
    action: string;
    kpi: string;
  }[];
}
