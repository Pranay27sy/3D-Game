'use strict';

// People in Mumbai talk to you in Marathi: a speech bubble over their head,
// spoken aloud by the phone's text-to-speech voice (Marathi, or Hindi if the
// phone has no Marathi voice; both read Devanagari). Train announcements too.
const Speech = (() => {
  const LINES = {
    // Small talk as you walk past.
    chat: [
      'काय रे, कसा आहेस?', 'चल, चहा पिऊया.', 'आज खूप ट्रॅफिक आहे.', 'लोकल पकडायची आहे, घाई आहे!',
      'वडापाव खाऊया का?', 'पाऊस येणार वाटतं.', 'बरं, नंतर भेटू.', 'गणपती बाप्पा मोरया!',
      'आज ऑफिसला उशीर झाला.', 'भाऊ, स्टेशन कुठे आहे?', 'किती गरम होतंय आज!', 'मस्त दिवस आहे ना?',
      'मुंबई कधी झोपत नाही.', 'चला, घरी जाऊया.', 'अरे वा, नवीन गाडी?',
    ],
    // When you honk at them or drive past too close.
    horn: ['अरे, हॉर्न कशाला वाजवतोस?', 'हळू चालव रे!', 'बघून चालव ना!', 'रस्ता तुझ्या बापाचा आहे का?', 'डोकं ठिकाणावर आहे का?'],
    near: ['अरे बाप रे!', 'वाचलो थोडक्यात!', 'काय करतोयस तू?', 'हळू रे, हळू!'],
    hit: ['अरे देवा!', 'आई गं!', 'पोलिसांना बोलवा!', 'मेलो रे!'],
    witness: ['पोलिसांना फोन करा!', 'अरे, त्याला पकडा!', 'बघा, बघा, काय केलं!'],
    thief: ['माझी गाडी! चोर, चोर!', 'थांब! माझी गाडी परत दे!'],
    police: ['थांब! पोलीस!', 'गाडी बाजूला घे!', 'हात वर कर!'],
    fareStart: ['भाऊ, लवकर चला!', 'दादरला जायचंय, पटकन!', 'मीटर चालू करा.'],
    fareEnd: ['इथेच थांबवा. धन्यवाद!', 'हे घ्या पैसे. धन्यवाद!'],
  };

  const cap = window.Capacitor;
  const plugin = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.registerPlugin ? cap.registerPlugin('TextToSpeech') : null;
  let enabled = true, voiceLang = null, lastSpoke = 0, scene = null;
  const bubbles = [];

  // Pick the best voice once: Marathi, then Hindi.
  async function chooseVoice() {
    if (voiceLang !== null) return voiceLang;
    voiceLang = '';
    try {
      if (plugin) {
        const { languages } = await plugin.getSupportedLanguages();
        const has = (l) => languages.some((x) => x.toLowerCase().startsWith(l));
        voiceLang = has('mr') ? 'mr-IN' : has('hi') ? 'hi-IN' : 'mr-IN';
      } else if (window.speechSynthesis) {
        const voices = speechSynthesis.getVoices();
        const v = voices.find((x) => x.lang.toLowerCase().startsWith('mr')) || voices.find((x) => x.lang.toLowerCase().startsWith('hi'));
        voiceLang = v ? v.lang : '';
      }
    } catch (e) { voiceLang = ''; }
    return voiceLang;
  }

  async function speak(text, volume = 1, priority = false) {
    if (!enabled || volume < 0.05) return;
    const now = performance.now();
    if (!priority && now - lastSpoke < 2500) return;
    lastSpoke = now;
    const lang = await chooseVoice();
    try {
      if (plugin) {
        if (priority) await plugin.stop().catch(() => {});
        await plugin.speak({ text, lang: lang || 'mr-IN', rate: 1.0, pitch: 1.0, volume: Math.min(1, volume), category: 'ambient' });
      } else if (window.speechSynthesis && lang) {
        if (priority) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.volume = Math.min(1, volume);
        const v = speechSynthesis.getVoices().find((x) => x.lang === lang);
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      }
    } catch (e) { /* no voice for this language on the phone: the bubble still shows */ }
  }

  function bubbleSprite(text) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.font = '700 40px "Noto Sans Devanagari", "Mukta", "Nirmala UI", sans-serif';
    const w = Math.min(500, g.measureText(text).width + 40);
    const x = (512 - w) / 2;
    g.fillStyle = 'rgba(255, 255, 255, 0.95)';
    g.strokeStyle = '#0a2b57';
    g.lineWidth = 4;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, 6, w, 86, 20); else g.rect(x, 6, w, 86);
    g.fill(); g.stroke();
    g.beginPath(); g.moveTo(246, 90); g.lineTo(256, 118); g.lineTo(268, 90); g.closePath(); g.fill();
    g.fillStyle = '#0a2b57';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 52, 480);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true }));
    s.scale.set(4.4, 1.1, 1);
    return s;
  }

  // Someone at `who` (anything with x, y, z) says a line of this kind.
  function say(kind, who, listener, opts = {}) {
    const list = LINES[kind];
    if (!list || !scene) return;
    const text = opts.text || list[Math.floor(Math.random() * list.length)];
    const d = listener ? Math.hypot(who.x - listener.x, who.z - listener.z) : 0;
    if (d > 45) return;
    if (bubbles.length >= 4) { const old = bubbles.shift(); scene.remove(old.sprite); }
    const sprite = bubbleSprite(text);
    scene.add(sprite);
    bubbles.push({ sprite, who, life: 3.2, y: opts.height || 2.6 });
    speak(text, 1 - d / 45, !!opts.priority);
  }

  function announce(text) { speak(text, 1, true); }

  function update(dt) {
    for (let k = bubbles.length - 1; k >= 0; k--) {
      const b = bubbles[k];
      b.life -= dt;
      b.sprite.position.set(b.who.x, (b.who.y || 0) + b.y, b.who.z);
      b.sprite.material.opacity = Math.min(1, b.life * 2);
      if (b.life <= 0) { scene.remove(b.sprite); b.sprite.material.map.dispose(); bubbles.splice(k, 1); }
    }
  }

  return {
    init(s) { scene = s; if (window.speechSynthesis) speechSynthesis.getVoices(); },
    say, announce, update,
    set enabled(on) { enabled = on; if (!on && window.speechSynthesis) speechSynthesis.cancel(); },
    get enabled() { return enabled; },
  };
})();
