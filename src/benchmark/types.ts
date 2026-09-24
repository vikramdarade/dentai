/**
 * Type Contracts for Clinical Benchmark & Golden-Set Audit (Work Package 6.0)
 *
 * Implements evaluation schemas for:
 * - 20 Multi-condition Australian operatory golden-set encounters
 * - Word Error Rate (WER <= 3.5%) Levenshtein clinical concept evaluator
 * - ISO 3950 FDI Tooth Notation (Precision/Recall >= 99.0%)
 * - Critical Pharmacology Safety Alert Sensitivity (= 100%)
 * - Chairside synthesis latency (< 4.0s)
 */

import type { AppointmentType, TranscriptItem, GeneratedNotePayload } from '../types';

export type AcousticCondition =
  | 'clean_operatory'
  | 'turbine_handpiece_noise' // 5,000 - 7,500 Hz notch target
  | 'high_volume_suction'
  | 'ultrasonic_scaler_noise'
  | 'muffled_ppe_surgical_mask';

export type AccentCondition =
  | 'broad_australian'
  | 'general_australian'
  | 'esl_indian_subcontinent'
  | 'esl_east_asian'
  | 'esl_mediterranean';

export interface ExpectedPharmacologyTrigger {
  drugOrAllergy: string;
  expectedAlertKind: 'contraindication' | 'interaction' | 'allergy' | 'dosage_warning';
  requiredWarningSubstring: string;
}

export interface GoldenSetCase {
  id: string; // e.g. "case-01"
  title: string;
  discipline:
    | 'restorative'
    | 'endodontics'
    | 'surgical_exodontia'
    | 'periodontics'
    | 'fixed_prosthodontics'
    | 'removable_prosthodontics'
    | 'paediatric'
    | 'preventive'
    | 'implantology'
    | 'trauma'
    | 'tmj_bruxism'
    | 'orthodontics'
    | 'oral_medicine';
  appointmentType: AppointmentType | string;
  patientName: string;
  patientDob: string;
  acousticCondition: AcousticCondition;
  accentCondition: AccentCondition;
  transcript: TranscriptItem[];
  /** Expected clinical terms for Levenshtein WER measurement */
  expectedClinicalConcepts: string[];
  /** Expected ISO 3950 FDI tooth numbers (11-48, 51-85) */
  expectedFdiTeeth: number[];
  /** Expected ADA item numbers */
  expectedAdaCodes: string[];
  /** Safety alerts that MUST be triggered with 100% sensitivity */
  expectedSafetyTriggers?: ExpectedPharmacologyTrigger[];
}

export interface WERMetrics {
  referenceWordCount: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  wordErrorRate: number; // 0.00 to 1.00 (e.g. 0.025 = 2.5%)
  conceptAccuracy: number; // 1.0 - WER
  missedConcepts?: string[];
}

export interface FdiMetrics {
  expectedTeeth: number[];
  extractedTeeth: number[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number; // TP / (TP + FP)
  recall: number; // TP / (TP + FN)
  f1Score: number;
}

export interface PharmacologyBenchmarkResult {
  expectedAlertCount: number;
  detectedAlertCount: number;
  falseNegatives: number;
  sensitivity: number; // detected / expected (1.0 = 100%)
  missedWarnings: string[];
}

export interface BenchmarkCaseResult {
  caseId: string;
  title: string;
  discipline: string;
  acousticCondition: AcousticCondition;
  accentCondition: AccentCondition;
  latencyMs: number;
  wer: WERMetrics;
  fdi: FdiMetrics;
  pharmacology: PharmacologyBenchmarkResult;
  adaAccuracy: {
    expectedCodes: string[];
    extractedCodes: string[];
    precision: number;
    recall: number;
  };
  generatedPayload: GeneratedNotePayload;
  passed: boolean;
  failureReasons: string[];
}

export interface OverallBenchmarkSummary {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageWER: number; // Must be <= 0.035 (3.5%)
  overallFdiPrecision: number; // Must be >= 0.99 (99.0%)
  overallFdiRecall: number; // Must be >= 0.99 (99.0%)
  pharmacologySensitivity: number; // Must be 1.00 (100.0%)
  averageLatencyMs: number; // Must be < 4000ms
  evaluatedAt: string;
  isCompliant: boolean;
  caseResults: BenchmarkCaseResult[];
}
