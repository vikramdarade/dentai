import React from 'react';
import { Camera, FileText, UploadCloud, AlertTriangle, Check, Plus, Trash2, X } from 'lucide-react';
import { formatClinicTime } from '../utils/date';

export interface DaysheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  scheduleImportTab: 'screenshot' | 'text';
  setScheduleImportTab: (tab: 'screenshot' | 'text') => void;
  daysheetRawText: string;
  setDaysheetRawText: (text: string) => void;
  handleParseAndImportDaysheet: () => void;
  detectedScheduleItems: any[];
  setDetectedScheduleItems: React.Dispatch<React.SetStateAction<any[]>>;
  handleScheduleImageFile: (file: File) => void;
  isScheduleParsing: boolean;
  scheduleParsingError: string | null;
  setScheduleParsingError: (err: string | null) => void;
  scheduleFileInputRef: React.RefObject<HTMLInputElement | null>;
  handleCommitDetectedSchedule: () => void;
  setSchedulePreviewImage: (img: string | null) => void;
}

export const DaysheetModal: React.FC<DaysheetModalProps> = ({
  isOpen,
  onClose,
  scheduleImportTab,
  setScheduleImportTab,
  daysheetRawText,
  setDaysheetRawText,
  handleParseAndImportDaysheet,
  detectedScheduleItems,
  setDetectedScheduleItems,
  handleScheduleImageFile,
  isScheduleParsing,
  scheduleParsingError,
  scheduleFileInputRef,
  handleCommitDetectedSchedule,
  setSchedulePreviewImage,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 sm:p-7 text-left relative my-8 animate-in fade-in duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-600 text-white flex items-center justify-center shadow-xs">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                Import Daily Schedule
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Paste Dental4Windows, Exact, or PMS schedule screenshot (<kbd className="px-1 py-0.2 bg-slate-100 border rounded font-mono text-[10px]">Win+Shift+S</kbd> &rarr; <kbd className="px-1 py-0.2 bg-slate-100 border rounded font-mono text-[10px]">⌘V</kbd>)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              setSchedulePreviewImage(null);
              setDetectedScheduleItems([]);
            }}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex items-center space-x-2 mt-4 pb-2 border-b border-slate-100 text-xs font-bold">
          <button
            type="button"
            onClick={() => setScheduleImportTab('screenshot')}
            className={`px-3.5 py-1.5 rounded-xl transition flex items-center space-x-1.5 cursor-pointer ${scheduleImportTab === 'screenshot'
                ? 'bg-sky-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Paste Screenshot (Vision AI)</span>
          </button>
          <button
            type="button"
            onClick={() => setScheduleImportTab('text')}
            className={`px-3.5 py-1.5 rounded-xl transition flex items-center space-x-1.5 cursor-pointer ${scheduleImportTab === 'text'
                ? 'bg-sky-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Paste Text / Day Sheet</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="mt-4 space-y-4">
          {scheduleImportTab === 'screenshot' && (
            <div className="space-y-3">
              {/* Dropzone / Paste Area */}
              {detectedScheduleItems.length === 0 && (
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.startsWith('image/')) {
                      handleScheduleImageFile(file);
                    }
                  }}
                  onClick={() => scheduleFileInputRef.current?.click()}
                  className="border-2 border-dashed border-sky-300 hover:border-sky-500 bg-sky-50/50 hover:bg-sky-50 rounded-2xl p-6 text-center cursor-pointer transition space-y-2 group"
                >
                  <input
                    ref={scheduleFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleScheduleImageFile(file);
                    }}
                  />
                  <div className="w-12 h-12 rounded-2xl bg-white border border-sky-200 text-sky-600 flex items-center justify-center mx-auto shadow-xs group-hover:scale-105 transition-transform">
                    {isScheduleParsing ? (
                      <div className="w-5 h-5 border-2 border-sky-600/30 border-t-sky-600 rounded-full animate-spin" />
                    ) : (
                      <UploadCloud className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">
                      {isScheduleParsing
                        ? 'Analyzing Schedule Screenshot with Vision AI...'
                        : 'Press Ctrl+V / ⌘V to Paste Schedule Screenshot'}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Or drag & drop / browse an image file (Dental4Windows, Exact, Praktika)
                    </p>
                  </div>
                </div>
              )}

              {/* Parsing Error Notice */}
              {scheduleParsingError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold">Extraction Notice</p>
                    <p className="text-[11px] text-rose-700">{scheduleParsingError}</p>
                  </div>
                  <button
                    onClick={() => scheduleFileInputRef.current?.click()}
                    className="text-[11px] font-bold text-rose-800 underline cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {/* Detected Schedule Items Review Table */}
              {detectedScheduleItems.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-900">
                        {detectedScheduleItems.length} Patients Detected
                      </span>
                      <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        Vision Verified
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDetectedScheduleItems([]);
                        setSchedulePreviewImage(null);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                    >
                      Scan Different Image
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-[40vh] overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                        <tr>
                          <th className="p-2.5 pl-3">Time</th>
                          <th className="p-2.5">Patient Name</th>
                          <th className="p-2.5">DOB</th>
                          <th className="p-2.5">Room</th>
                          <th className="p-2.5">Procedure</th>
                          <th className="p-2.5 text-right pr-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detectedScheduleItems.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-slate-50/80 transition">
                            <td className="p-2.5 pl-3 font-mono font-bold text-slate-700">
                              <input
                                type="text"
                                value={item.time}
                                onChange={e => {
                                  const val = e.target.value;
                                  setDetectedScheduleItems(prev =>
                                    prev.map((it, i) => (i === idx ? { ...it, time: val } : it))
                                  );
                                }}
                                className="w-16 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono font-bold outline-none"
                              />
                            </td>
                            <td className="p-2.5 font-bold text-slate-900">
                              <input
                                type="text"
                                value={item.patientName}
                                onChange={e => {
                                  const val = e.target.value;
                                  setDetectedScheduleItems(prev =>
                                    prev.map((it, i) => (i === idx ? { ...it, patientName: val } : it))
                                  );
                                }}
                                className="w-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs font-bold outline-none"
                              />
                            </td>
                            <td className="p-2.5 text-slate-600">
                              <input
                                type="text"
                                placeholder="DD/MM/YYYY"
                                value={item.dob}
                                onChange={e => {
                                  const val = e.target.value;
                                  setDetectedScheduleItems(prev =>
                                    prev.map((it, i) => (i === idx ? { ...it, dob: val } : it))
                                  );
                                }}
                                className="w-24 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium outline-none"
                              />
                            </td>
                            <td className="p-2.5">
                              <select
                                value={item.room}
                                onChange={e => {
                                  const val = e.target.value;
                                  setDetectedScheduleItems(prev =>
                                    prev.map((it, i) => (i === idx ? { ...it, room: val } : it))
                                  );
                                }}
                                className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium outline-none"
                              >
                                <option value="Room 1">Room 1</option>
                                <option value="Room 2">Room 2</option>
                                <option value="Room 3">Room 3</option>
                              </select>
                            </td>
                            <td className="p-2.5 text-slate-600">
                              <input
                                type="text"
                                value={item.procedureText}
                                onChange={e => {
                                  const val = e.target.value;
                                  setDetectedScheduleItems(prev =>
                                    prev.map((it, i) => (i === idx ? { ...it, procedureText: val } : it))
                                  );
                                }}
                                className="w-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs outline-none"
                              />
                            </td>
                            <td className="p-2.5 text-right pr-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setDetectedScheduleItems(prev => prev.filter((_, i) => i !== idx))
                                }
                                className="text-slate-400 hover:text-rose-600 p-1 rounded transition cursor-pointer"
                                title="Remove patient"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setDetectedScheduleItems(prev => [
                          ...prev,
                          {
                            id: `detected-manual-${Date.now()}`,
                            time: formatClinicTime(new Date()),
                            patientName: 'New Patient',
                            dob: '',
                            room: 'Room 1',
                            procedureText: 'General Consultation',
                            appointmentType: 'examination',
                            templateId: 'standard'
                          }
                        ]);
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition flex items-center space-x-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-sky-600" />
                      <span>Add Row</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCommitDetectedSchedule}
                      className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Import Schedule ({detectedScheduleItems.length} Patients)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {scheduleImportTab === 'text' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Paste lines copied from your appointment book, spreadsheet, or daysheet:
              </p>
              <textarea
                rows={7}
                value={daysheetRawText}
                onChange={e => setDaysheetRawText(e.target.value)}
                placeholder={`09:00 Justin Tran (14/05/2012) - CDBS Paediatric Exam & Clean\n09:40 Ryan Tran (20/09/2014) - CDBS Paediatric Clean\n11:30 Lorraine Pugh (03/11/1968) - Stage 2 Crown Prep\n14:00 Elke Wolswinkel - 26 + 18 exo\n15:00 Raphael Tannen - Check up and clean`}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono focus:border-sky-600 outline-none leading-relaxed"
              />
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  disabled={!daysheetRawText.trim()}
                  onClick={handleParseAndImportDaysheet}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Import Text Schedule</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
