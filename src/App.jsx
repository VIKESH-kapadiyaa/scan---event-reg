import React, { useState, useEffect, useRef } from 'react';
import { Camera, Upload, CheckCircle2, AlertCircle, X, Scan, ShieldCheck, FileSpreadsheet, RotateCcw, Leaf, Trees, Sprout, Wind, Image as ImageIcon } from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';

import { Capacitor } from '@capacitor/core';
import { Camera as CapacitorCamera } from '@capacitor/camera';
import { Html5Qrcode, Html5QrcodeScanner } from 'html5-qrcode';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export default function App() {
  const [attendees, setAttendees] = useState([]);
  const [scanStatus, setScanStatus] = useState('idle'); // idle, success, error
  const [matchedUser, setMatchedUser] = useState(null);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const scannerRef = useRef(null);

  // New state for manual text entry
  const [manualData, setManualData] = useState("");
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Removed useEffect for script loading

  const handleManualSubmit = () => {
    if (!manualData.trim()) return;

    // Auto-detect CSV-like structure or just simple list
    const parsedData = Papa.parse(manualData, {
      header: true,
      skipEmptyLines: true
    });

    if (parsedData.data && parsedData.data.length > 0 && Object.keys(parsedData.data[0]).length > 1) {
      setAttendees(parsedData.data);
    } else {
      // Fallback: Treat as a simple list of IDs (one per line)
      const lines = manualData.split(/\r?\n/).filter(line => line.trim() !== "");
      const simpleAttendees = lines.map(line => ({
        registration_id: line.trim(),
        attendee_name: "Participant"
      }));
      setAttendees(simpleAttendees);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();

    if (extension === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => setAttendees(results.data)
      });
    } else if (['xlsx', 'xls'].includes(extension)) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        setAttendees(XLSX.utils.sheet_to_json(ws));
      };
      reader.readAsBinaryString(file);
    } else if (extension === 'pdf') {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = await import('pdfjs-dist/build/pdf');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let extractedData = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();

          // Simple extraction strategy: assume tabular data where lines represent rows
          // This is a basic implementation and might need refinement based on specific PDF structure
          const pageText = textContent.items.map(item => item.str).join(' ');

          // Attempt to find patterns that look like IDs and Names
          // This is highly dependent on the PDF format.
          // For now, we'll try to split by some delimiter or just store raw text if structure is complex
          // A more robust approach would be to prompt user for column mapping or use a specific PDF table parser

          // Heuristic: matching common patterns if possible, or just creating a raw entry
          // For this demo, let's treat every non-empty line as a potential record if we were splitting by newline
          // But pdf text extraction often loses newlines.

          // Better approach for general PDF:
          // push a generic object that might need manual verification if not structured
          // OR: Just alert that PDF support matches exact strings found in the document

          extractedData.push({ raw_content: pageText });
        }

        // Since PDF parsing is unstructured compared to CSV/Excel, 
        // we might want to flag this or handle it differently. 
        // For now, we will map the raw text to a structure the scanner can check against
        // (i.e. if the scanned ID is present in the PDF text anywhere)

        // Let's refine the "found" logic in onScanSuccess to search in raw_data if present
        setAttendees(extractedData);
        alert("PDF loaded. Note: PDF verification checks if the scanned ID exists anywhere in the document text.");

      } catch (error) {
        console.error("Error reading PDF:", error);
        alert("Failed to parse PDF file.");
      }
    }
  };

  const handleQrImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const html5QrCode = new Html5Qrcode("qr-file-reader");
      const decodedText = await html5QrCode.scanFile(file, true);
      onScanSuccess(decodedText);
    } catch (err) {
      console.error("Error scanning file:", err);
      // If we differ success/error states, we might want a specific error for "Invalid QR"
      // For now, trigger the standard error state
      setScanStatus('error');
    }
  };

  const startScanner = async () => {
    // Check for native platform permissions
    if (Capacitor.isNativePlatform()) {
      try {
        const permissions = await CapacitorCamera.checkPermissions();
        if (permissions.camera !== 'granted') {
          const request = await CapacitorCamera.requestPermissions({ permissions: ['camera'] });
          if (request.camera !== 'granted') {
            alert('Camera permission is required to scan QR codes.');
            return;
          }
        }
      } catch (err) {
        console.error("Error requesting camera permissions:", err);
      }
    }

    setIsScannerActive(true);

    // Slight delay to ensure DOM element exists
    setTimeout(() => {
      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;

      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      // Prefer back camera ("environment")
      html5QrCode.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanFailure
      ).catch(err => {
        console.error("Error starting scanner:", err);
        setIsScannerActive(false);
        alert("Failed to start camera. Please ensure permissions are granted.");
      });
    }, 100);
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().then(() => {
        scannerRef.current.clear();
        setIsScannerActive(false);
      }).catch(err => {
        console.error("Failed to stop scanner", err);
        setIsScannerActive(false);
      });
    } else {
      setIsScannerActive(false);
    }
  };

  const onScanSuccess = (decodedText) => {
    const normalize = (str) => String(str || '').trim().toLowerCase();
    const cleanDecoded = normalize(decodedText);

    const found = attendees.find(u => {
      // Get ID from various possible keys
      const rawId = u.registration_id || u.RegistrationID || u.registration_ID || u.id;
      if (!rawId && !u.raw_content) return false;

      // Normalization check
      const cleanId = normalize(rawId);

      // 1. Exact match (normalized)
      if (cleanId === cleanDecoded) return true;

      // 2. Substring match (robustness for hidden chars or prefixes)
      if (cleanId.includes(cleanDecoded) || cleanDecoded.includes(cleanId)) return true;

      // 3. Fuzzy search in raw PDF content
      if (u.raw_content && normalize(u.raw_content).includes(cleanDecoded)) return true;

      return false;
    });

    if (found) {
      setMatchedUser(found);
      setScanStatus('success');
    } else {
      // DEBUG: Show what was actually scanned vs what is in data
      const sampleId = attendees.length > 0
        ? (attendees[0].registration_id || attendees[0].RegistrationID || 'N/A')
        : 'Empty List';

      alert(`DEBUG: Scan Mismatch\n\nScanned: "${decodedText}"\nNormalized: "${cleanDecoded}"\n\nAttendees Loaded: ${attendees.length}\nSample ID[0]: "${sampleId}"\n\nPlease check for extra spaces or case differences.`);

      setScanStatus('error');
    }
    stopScanner();
  };

  const onScanFailure = () => { };

  const resetScanner = () => {
    setScanStatus('idle');
    setMatchedUser(null);
    startScanner();
  };

  // Removed loading check


  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FDFCF0] text-[#344E41] font-sans selection:bg-[#A3B18A]/30 relative overflow-hidden">

      {/* Organic Background Elements */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-5%] right-[-5%] w-[400px] h-[400px] bg-[#A3B18A]/20 rounded-full blur-[80px]"></div>
        <div className="absolute bottom-[10%] left-[-10%] w-[350px] h-[350px] bg-[#DAD7CD]/40 rounded-full blur-[100px]"></div>
      </div>

      {/* Header */}
      <nav className="flex-none sticky top-0 z-30 bg-[#FDFCF0]/70 backdrop-blur-md border-b border-[#A3B18A]/20 p-5">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-[#588157] rounded-2xl shadow-lg shadow-[#3A5A40]/10">
              <Trees className="text-[#FDFCF0]" size={24} />
            </div>
            <div>
              <h1 className="font-serif font-bold text-[#344E41] text-xl">Algo Arena <span className="text-[#588157] font-sans italic">1.0</span></h1>
              <p className="text-[10px] text-[#A3B18A] font-bold uppercase tracking-[0.2em]">NextGenX AI Club // IILM</p>
            </div>
          </div>
          <div className="bg-[#DAD7CD]/30 px-4 py-1.5 rounded-full border border-[#A3B18A]/20">
            <span className="text-xs font-semibold text-[#588157]">
              {attendees.length > 0 ? `${attendees.length} Seeds Planted` : 'Garden Empty'}
            </span>
          </div>
        </div>
      </nav>

      <main className="flex-1 relative z-10 p-6 max-w-xl mx-auto flex flex-col justify-center w-full">

        {/* Step 1: Data Initialization */}
        {attendees.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/80 border border-[#A3B18A]/30 backdrop-blur-sm rounded-[40px] p-10 text-center shadow-xl shadow-[#3A5A40]/5"
          >
            <div className="mb-8 inline-flex p-6 bg-[#F3F4F0] rounded-[30px] text-[#588157]">
              <FileSpreadsheet size={48} />
            </div>
            <h2 className="text-2xl font-serif font-bold text-[#344E41] mb-3">Begin the Harvest</h2>
            <p className="text-[#588157]/70 text-sm mb-10 leading-relaxed italic">
              Please upload your participant list to start welcoming people to the Arena.
            </p>
            <label className="group relative cursor-pointer inline-flex items-center gap-3 bg-[#3A5A40] text-[#FDFCF0] px-10 py-4 rounded-full font-bold hover:bg-[#588157] transition-all shadow-lg active:scale-95">
              <Upload size={20} />
              UPLOAD LIST
              <input type="file" className="hidden" accept=".csv, .xlsx, .xls, .pdf" onChange={handleFileUpload} />
            </label>
          </motion.div>
        )}

        {/* Step 2: Live Scanning Control */}
        {attendees.length > 0 && scanStatus === 'idle' && (
          <div className="space-y-10">
            {!isScannerActive ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center bg-white/80 border border-[#A3B18A]/30 backdrop-blur-sm rounded-[30px] p-8 shadow-xl"
              >
                <div className="mb-10 flex justify-center">
                  <div className="relative">
                    <div className="absolute inset-0 bg-[#588157]/10 rounded-full blur-2xl animate-pulse"></div>
                    <div className="relative w-24 h-24 bg-[#F3F4F0] rounded-full flex items-center justify-center">
                      <Camera className="text-[#588157]" size={40} />
                    </div>
                  </div>
                </div>
                <h3 className="text-xl font-serif font-bold text-[#344E41] mb-2">Scanner Dormant</h3>
                <p className="text-[#588157]/70 text-sm mb-10 italic">Awaken the camera to verify guests.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={startScanner}
                    className="w-full py-5 bg-[#588157] text-[#FDFCF0] rounded-full font-bold text-lg shadow-lg hover:bg-[#3A5A40] transition-all flex items-center justify-center gap-2"
                  >
                    <Camera size={24} />
                    START CAMERA
                  </button>
                  <label className="cursor-pointer w-full py-5 bg-[#DAD7CD] text-[#344E41] rounded-full font-bold text-lg shadow-lg hover:bg-[#A3B18A] transition-all flex items-center justify-center gap-2 relative overflow-hidden group">
                    <ImageIcon size={24} />
                    UPLOAD QR IMAGE
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={handleQrImageUpload}
                    />
                  </label>
                </div>
              </motion.div>
            ) : (
              <div className="relative rounded-[50px] overflow-hidden bg-[#344E41] border-[12px] border-white shadow-2xl aspect-[3/4]">
                <div id="reader" className="w-full h-full object-cover"></div>
                <button
                  onClick={stopScanner}
                  className="absolute top-4 right-4 z-50 bg-white/20 backdrop-blur-md text-white p-2.5 rounded-full hover:bg-white/40 transition-all"
                >
                  <X size={20} />
                </button>
                <div className="absolute bottom-8 left-0 right-0 text-center pointer-events-none">
                  <p className="text-white/80 text-xs uppercase tracking-widest font-bold">Align QR Code</p>
                </div>
              </div>
            )}

            {/* Hidden Reader for File-based Scanning */}
            <div id="qr-file-reader" className="hidden"></div>

            <button
              onClick={() => setAttendees([])}
              className="w-full text-[#A3B18A] font-bold text-[10px] uppercase tracking-[0.2em] hover:text-[#588157] transition-colors"
            >
              <RotateCcw size={12} className="inline mr-2" /> Reset Master List
            </button>
          </div>
        )}

        {/* Global Overlays for Scan Results */}
        <AnimatePresence>
          {scanStatus === 'success' && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-[#FDFCF0]/90 backdrop-blur-xl p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="w-full max-w-[90%] bg-white border border-[#A3B18A]/30 rounded-[40px] p-6 text-center shadow-2xl"
              >
                <div className="mb-6 inline-flex p-5 bg-[#F3F4F0] rounded-full text-[#588157]">
                  <ShieldCheck size={48} />
                </div>
                <h2 className="text-3xl font-serif font-bold text-[#344E41] mb-2 tracking-tight">Verified</h2>
                <p className="text-[#588157] font-medium text-[10px] uppercase tracking-widest mb-8 italic">Welcome to the Arena</p>

                <div className="bg-[#FDFCF0] p-6 rounded-[30px] text-left border border-[#A3B18A]/20 mb-8 shadow-inner">
                  <div className="mb-4">
                    <span className="text-[9px] font-bold text-[#A3B18A] uppercase tracking-widest block mb-1">Guest</span>
                    <span className="text-xl font-serif font-bold text-[#344E41] line-clamp-2">{matchedUser?.display_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold text-[#A3B18A] uppercase tracking-widest block mb-1">ID Reference</span>
                      <span className="text-[10px] font-mono text-[#588157] bg-[#588157]/10 px-2 py-1 rounded-full">{matchedUser?.registration_id || matchedUser?.RegistrationID || matchedUser?.id || 'ARENA_MEMBER'}</span>
                    </div>
                    <Leaf className="text-[#A3B18A]/40" size={20} />
                  </div>
                </div>

                <button
                  onClick={resetScanner}
                  className="w-full py-4 bg-[#344E41] text-[#FDFCF0] rounded-full font-bold text-base hover:shadow-xl transition-all"
                >
                  NEXT GUEST
                </button>
              </motion.div>
            </motion.div>
          )}

          {scanStatus === 'error' && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-[#588157]/10 backdrop-blur-xl p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="w-full max-w-[90%] bg-white border border-[#A3B18A]/30 rounded-[40px] p-8 text-center shadow-2xl"
              >
                <div className="mb-6 inline-flex p-5 bg-red-50 rounded-full text-red-400">
                  <AlertCircle size={48} />
                </div>
                <h2 className="text-2xl font-serif font-bold text-[#344E41] mb-2">Unknown Seed</h2>
                <p className="text-red-400 font-bold text-[10px] uppercase tracking-widest mb-8">Verification Failed</p>

                <button
                  onClick={resetScanner}
                  className="w-full py-4 bg-red-500 text-white rounded-full font-bold text-base hover:bg-red-600 transition-all"
                >
                  RE-SCAN
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      <footer className="flex-none relative p-8 text-center z-20 pointer-events-none">
        <div className="inline-flex items-center gap-4 bg-white/40 backdrop-blur-md px-8 py-3 rounded-full border border-[#A3B18A]/30 shadow-sm">
          <span className="text-[10px] font-bold text-[#344E41]/40 uppercase tracking-[0.4em]">07 FEB 2026 // ALGO ARENA // ENGINEERING BLOCK</span>
        </div>
      </footer>
    </div>
  );
}
