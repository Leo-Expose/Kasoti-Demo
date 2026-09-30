/**
 * KASOTI-Demo — bilingual strings.
 *
 * Every string the verdict engine prints has an English and a Hindi form in the
 * real product (`core/.../i18n/Messages.kt`, enforced by a test that fails when a
 * finding code is missing one). The demo replays those exact strings from the real
 * engine output, so it inherits the pairing rather than inventing it.
 *
 * This dictionary covers the demo's own chrome only.
 */

export const STR = {
  'nav.mrz':        ['MRZ lab', 'MRZ प्रयोगशाला'],
  'nav.corpus':     ['Corpus', 'कॉर्पस'],
  'nav.pdf':        ['PDF check', 'PDF जाँच'],
  'nav.verdicts':   ['Verdicts', 'निर्णय'],
  'nav.measured':   ['Measured', 'मापे गए'],
  'nav.limits':     ['Limits', 'सीमाएँ'],

  'hero.eyebrow':   ['Browser build · no server · no account', 'ब्राउज़र बिल्ड · कोई सर्वर नहीं · कोई खाता नहीं'],
  'hero.h1a':       ['A perfect forgery of the data', 'डेटा की एक पूर्ण नकल'],
  'hero.h1b':       ['is still the wrong artifact.', 'फिर भी गलत वस्तु है।'],
  'hero.lede': [
    'KASOTI screens travel documents at border posts. It checks the machine-readable zone against ICAO 9303, cross-checks the printed page against it, and refuses to return a verdict when a check did not run. This page runs that logic in your browser — your document never leaves this machine.',
    'KASOTI सीमा पोस्ट पर यात्रा दस्तावेज़ जाँचता है। यह मशीन-पठन क्षेत्र को ICAO 9303 के अनुसार जाँचता है, मुद्रित पृष्ठ की उससे तुलना करता है, और जब कोई जाँच नहीं चली तो निर्णय देने से मना कर देता है। यह पृष्ठ वही तर्क आपके ब्राउज़र में चलाता है — आपका दस्तावेज़ इस मशीन से कभी बाहर नहीं जाता।',
  ],
  'hero.cta1':      ['Check a document', 'दस्तावेज़ जाँचें'],
  'hero.cta2':      ['Upload a PDF', 'PDF अपलोड करें'],
  'hero.cta3':      ['See the corpus', 'कॉर्पस देखें'],

  'lab.eyebrow':    ['Live · ICAO 9303 part 4, 5, 6', 'लाइव · ICAO 9303 भाग 4, 5, 6'],
  'lab.h2':         ['The check digit, with the arithmetic shown', 'चेक डिजिट, गणना के साथ'],
  'lab.lede': [
    'Every check digit in a machine-readable zone is a weighted sum mod 10. Weights repeat 7, 3, 1. Characters map 0–9 to 0–9, A–Z to 10–35, and the filler < to 0. Paste any zone and watch it resolve.',
    'मशीन-पठन क्षेत्र का हर चेक डिजिट भार-गुणित योग mod 10 है। भार 7, 3, 1 दोहराते हैं। अक्षर 0–9 से 0–9, A–Z से 10–35, और फिलर < से 0। कोई भी क्षेत्र चिपकाएँ और गणना देखें।',
  ],
  'lab.verdict':    ['Result', 'परिणाम'],
  'lab.fields':     ['Extracted fields', 'निकाले गए फ़ील्ड'],
  'lab.checks':     ['Check digits', 'चेक डिजिट'],
  'lab.math':       ['Working', 'गणना'],
  'lab.expected':   ['expected', 'अपेक्षित'],
  'lab.observed':   ['observed', 'पाया गया'],
  'lab.sum':        ['sum', 'योग'],
  'lab.weight':     ['weight', 'भार'],
  'lab.value':      ['value', 'मान'],
  'lab.product':    ['product', 'गुणनफल'],
  'lab.char':       ['char', 'अक्षर'],
  'lab.nozone':     ['No machine-readable zone found', 'कोई मशीन-पठन क्षेत्र नहीं मिला'],
  'lab.hint':       [
    'A TD3 zone is 2 lines of 44 characters. A TD1 zone is 3 lines of 30. Anything else is reported as unrecognised rather than guessed at.',
    'TD3 क्षेत्र 44 अक्षरों की 2 पंक्तियाँ होता है। TD1 क्षेत्र 30 अक्षरों की 3 पंक्तियाँ। अन्य को अनुमान लगाने के बजाय “अपरिचित” बताया जाता है।',
  ],

  'corpus.eyebrow': ['10,000 mutated documents', '10,000 उत्परिवर्तित दस्तावेज़'],
  'corpus.h2':      ['Run the whole corpus yourself', 'पूरा कॉर्पस स्वयं चलाएँ'],
  'corpus.lede': [
    'This is the corpus from our evaluation run, shipped as data. Your browser re-checks all 10,000 rows with the engine above and compares the outcome against what the JVM harness recorded for each row. If the totals match, the port is correct.',
    'यह हमारे मूल्यांकन रन का कॉर्पस है, डेटा के रूप में। आपका ब्राउज़र ऊपर के इंजन से सभी 10,000 पंक्तियाँ दोबारा जाँचता है और परिणाम की तुलना JVM हार्नेस द्वारा दर्ज की गई पंक्ति-वार रिकॉर्ड से करता है। यदि योग मेल खाते हैं, तो पोर्ट सही है।',
  ],
  'corpus.run':     ['Run 10,000 rows', '10,000 पंक्तियाँ चलाएँ'],
  'corpus.running': ['Checking', 'जाँच हो रही है'],
  'corpus.rows':    ['rows checked', 'जाँची गई पंक्तियाँ'],
  'corpus.agree':   ['rows matching the JVM', 'JVM से मेल खाती पंक्तियाँ'],
  'corpus.caught':  ['mutants caught', 'पकड़े गए उत्परिवर्तन'],
  'corpus.detect':  ['of which detectable', 'जिनमें पहचान संभव'],
  'corpus.blind':   ['structurally blind', 'संरचनात्मक अंधापन'],
  'corpus.fp':      ['false positives', 'झूठे सकारात्मक'],
  'corpus.bymut':   ['Catch rate by mutation', 'उत्परिवर्तन अनुसार पकड़ दर'],
  'corpus.blindwhy':['Why the blind rows are blind', 'अंधी पंक्तियाँ अंधी क्यों हैं'],
  'corpus.selfcheck':['Self-check against the JVM run', 'JVM रन से स्व-जाँच'],
  'corpus.selfok':  ['Agrees with the recorded run on every row.', 'हर पंक्ति पर दर्ज रन से सहमति।'],
  'corpus.selfbad': ['Disagreement found — the port is wrong and we are showing you.', 'विचलन मिला — पोर्ट गलत है और हम यह दिखा रहे हैं।'],

  'pdf.eyebrow':    ['Runs entirely on this page', 'पूरी तरह इसी पृष्ठ पर चलता है'],
  'pdf.h2':         ['Drop a PDF. Watch what we can and cannot tell.', 'PDF छोड़ें। देखें हम क्या और क्या नहीं बता सकते।'],
  'pdf.lede': [
    'The file is read with a PDF parser inside your browser. No upload, no server, no request carrying your document. We pull the text layer, look for a machine-readable zone, run the same check digits, and report the document metadata — which on its own is weak evidence, and we say so.',
    'फ़ाइल आपके ब्राउज़र में ही PDF पार्सर से पढ़ी जाती है। कोई अपलोड नहीं, कोई सर्वर नहीं, आपके दस्तावेज़ को ले जाने वाला कोई अनुरोध नहीं। हम टेक्स्ट लेयर निकालते हैं, मशीन-पठन क्षेत्र खोजते हैं, वही चेक डिजिट चलाते हैं, और दस्तावेज़ मेटाडेटा दिखाते हैं — जो अपने आप में कमज़ोर साक्ष्य है, और हम यह भी बताते हैं।',
  ],
  'pdf.pick':       ['Choose a PDF, or drop one here', 'PDF चुनें, या यहाँ छोड़ें'],
  'pdf.max':        ['PDF only · 4 MB maximum · nothing is uploaded', 'केवल PDF · अधिकतम 4 MB · कुछ भी अपलोड नहीं'],
  'pdf.sample':     ['No passport handy? Generate a specimen', 'पासपोर्ट नहीं है? एक नमूना बनाएँ'],
  'pdf.sampleNote': [
    'Builds a PDF in this tab, on the spot, with a real MRZ inside — one valid, one with a single digit altered. Nothing is fetched.',
    'इसी टैब में, तुरंत, एक असली MRZ वाला PDF बनाता है — एक सही, एक में एक अंक बदला हुआ। कुछ भी फ़ेच नहीं होता।',
  ],
  'pdf.privacy':    ['This document never left your device', 'यह दस्तावेज़ आपके उपकरण से बाहर नहीं गया'],
  'pdf.nomrz':      ['No machine-readable zone found in the text layer', 'टेक्स्ट लेयर में कोई मशीन-पठन क्षेत्र नहीं मिला'],
  'pdf.meta':       ['Document metadata (weak evidence)', 'दस्तावेज़ मेटाडेटा (कमज़ोर साक्ष्य)'],
  'pdf.pages':      ['pages', 'पृष्ठ'],
  'pdf.scanned':    ['This looks like a scan with no text layer. Our OCR needs a native build, so we stop here rather than guess.', 'यह ऐसा स्कैन लगता है जिसमें टेक्स्ट लेयर नहीं है। हमारा OCR को मूल बिल्ड चाहिए, इसलिए हम अनुमान लगाने के बजाय यहीं रुक जाते हैं।'],

  'v.eyebrow':      ['Real engine output, replayed', 'वास्तविक इंजन आउटपुट, पुनः प्रदर्शित'],
  'v.h2':           ['What the system actually said', 'सिस्टम ने वास्तव में क्या कहा'],
  'v.lede': [
    'These are not mock-ups. Each panel is the verbatim console transcript of the real screening engine, captured by a script that runs the engine and fails loudly if its verdict changes. This page replays the output; it does not re-run fusion in the browser.',
    'ये मॉक-अप नहीं हैं। प्रत्येक पैनल असली स्क्रीनिंग इंजन का शाब्दिक कंसोल ट्रांसक्रिप्ट है, जिसे एक स्क्रिप्ट ने इंजन चलाकर लिया है और निर्णय बदलने पर ज़ोर से रुक जाता है। यह पृष्ठ आउटपुट दोहराता है; यह ब्राउज़र में फ्यूज़न दोबारा नहीं चलाता।',
  ],
  'v.layers':       ['Layers', 'परतें'],
  'v.findings':     ['Findings', 'निष्कर्ष'],
  'v.rationale':    ['Warnings', 'चेतावनियाँ'],
  'v.action':       ['Action', 'कार्रवाई'],
  'v.en':           ['Officer-facing (English)', 'अधिकारी-संबंधी (अंग्रेज़ी)'],
  'v.hi':           ['अधिकारी-संबंधी (हिन्दी)', 'अधिकारी-संबंधी (हिन्दी)'],
  'v.raw':          ['Raw console transcript', 'कच्चा कंसोल ट्रांसक्रिप्ट'],
  'v.track':        ['Track', 'ट्रैक'],
  'v.green':        [
    'GREEN is unreachable from this page. The face layer has no embedding model bound, so the engine never has enough to clear a document. We are not going to fake a pass to make a demo look decisive.',
    'इस पृष्ठ से GREEN तक पहुँचना असंभव है। फेस परत में कोई एम्बेडिंग मॉडल बंधा नहीं है, इसलिए इंजन के पास कभी पर्याप्त साक्ष्य नहीं होता। डेमो को निर्णायक दिखाने के लिए हम नकली पास नहीं बनाएँगे।',
  ],

  'm.eyebrow':      ['Every number below came from one command', 'नीचे का हर अंक एक ही कमांड से आया'],
  'm.h2':           ['The measurement record', 'माप रिकॉर्ड'],
  'm.run':          ['Run', 'रन'],
  'm.commit':       ['Commit', 'कमिट'],
  'm.split':        ['Tuned split', 'ट्यून्ड स्प्लिट'],
  'm.status':       ['Status', 'स्थिति'],
  'm.qr':           ['Secure-QR verification', 'सुरक्षित QR सत्यापन'],
  'm.diary':        ['Crossing-diary scripts', 'क्रॉसिंग-डायरी स्क्रिप्ट'],
  'm.latency':      ['Latency, host JVM', 'विलंबता, होस्ट JVM'],
  'm.calib':        ['Device calibration', 'उपकरण कैलिब्रेशन'],
  'm.untuned':      ['Thresholds still at their untuned default', 'अब भी अन-ट्यून्ड डिफ़ॉल्ट पर थ्रेशहोल्ड'],

  'l.eyebrow':      ['The part most demos hide', 'वह हिस्सा जो अधिकांश डेमो छिपाते हैं'],
  'l.h2':           ['What this project has not done', 'यह परियोजना क्या नहीं कर पायी'],
  'l.intro': [
    'Four things are unfinished. None of them are hidden in this build, and none of them are worked around with a plausible-looking number.',
    'चार काम अधूरे हैं। इनमें से कोई भी इस बिल्ड में छिपा नहीं है, और किसी को भी आँखों को ठीक लगने वाले अंक से नहीं सँवारा गया है।',
  ],
};

let current = 'en';

export function setLang(l) { current = l === 'hi' ? 'hi' : 'en'; }
export function getLang() { return current; }

/** Look up a key, optionally substituting {name} placeholders. */
export function t(key, vars) {
  const pair = STR[key];
  if (!pair) return key;
  let s = pair[current === 'hi' ? 1 : 0];
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll('{' + k + '}', vars[k]);
  return s;
}

/** Apply the active language to every [data-en]/[data-hi] pair in the document. */
export function applyStatic(root = document) {
  const attr = current === 'hi' ? 'data-hi' : 'data-en';
  root.querySelectorAll('[data-en][data-hi]').forEach((el) => {
    const v = el.getAttribute(attr);
    if (v != null) el.textContent = v;
  });
  document.documentElement.lang = current === 'hi' ? 'hi' : 'en';
}
