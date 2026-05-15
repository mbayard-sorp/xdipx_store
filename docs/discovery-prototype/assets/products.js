// Shared product catalog for xdipx home concepts.
// Tags: moods, audience, matters, category (top-nav), subcategory.
// Visual hint: 'photo' | 'tile' | 'text' lets cards mix presentation styles.

window.XDIPX_TAXONOMY = {
  moods: [
    'Sensual', 'Slow & Intimate', 'Playful', 'Adventurous', 'Bold',
    'Indulgent', 'Romantic', 'Curious', 'Comforting', 'Energetic', 'Unhurried Solo'
  ],
  audience: [
    'Me', 'Us', 'A Partner', 'Date Night', 'Solo', 'Gift'
  ],
  matters: [
    'Beginner-Friendly', 'Body-Safe Silicone', 'Discreet Design', 'First-Time',
    'Hands-Free', 'Rechargeable', 'Soft-Touch', 'Travel-Size', 'Waterproof',
    'App-Controlled', 'Whisper-Quiet', 'Plus-Size-Friendly'
  ],
  categories: {
    Pleasure: ['Vibrators', 'Dildos', 'For Him', 'Anal'],
    Play:     ['Bondage & Kink', 'Couples'],
    Body:     ['Lubricants', 'Massage', 'Wellness'],
    Wear:     ['Lingerie', 'Accessories']
  }
};

// Tile colors pulled from a small warm palette — cards without photos
// get a tinted abstract tile in one of these tones.
const T = {
  blush:  '#f3d3c6',
  clay:   '#d9a890',
  plum:   '#7a3a78',
  ink:    '#2a1f2a',
  cream:  '#efe5d5',
  amber:  '#d18a4d',
  rose:   '#c76a78',
  sage:   '#a9b39a',
};

window.XDIPX_PRODUCTS = [
  // ───── Pleasure / Vibrators
  { id:'velvet-wand', name:'Velvet Wand Vibrator',     cat:'Pleasure', sub:'Vibrators', price:148,
    mood:['Sensual','Slow & Intimate','Indulgent','Unhurried Solo'], aud:['Me','Solo','Us'],
    matters:['Whisper-Quiet','Rechargeable','Body-Safe Silicone','Hands-Free'], visual:'photo', tone:T.plum },
  { id:'pebble-mini', name:'Pebble Mini',              cat:'Pleasure', sub:'Vibrators', price:62,
    mood:['Playful','Curious','Comforting'], aud:['Me','Solo','Gift','Date Night'],
    matters:['Beginner-Friendly','First-Time','Travel-Size','Waterproof','Discreet Design'], visual:'tile', tone:T.blush },
  { id:'curve-wand', name:'Curve G-Wand',              cat:'Pleasure', sub:'Vibrators', price:118,
    mood:['Bold','Adventurous','Indulgent'], aud:['Me','Solo','Us'],
    matters:['Rechargeable','Body-Safe Silicone','Whisper-Quiet'], visual:'photo', tone:T.rose },
  { id:'bullet-whisper', name:'Whisper Bullet',        cat:'Pleasure', sub:'Vibrators', price:38,
    mood:['Curious','Playful','Comforting','Slow & Intimate'], aud:['Me','Solo','Gift'],
    matters:['Beginner-Friendly','Travel-Size','Whisper-Quiet','Discreet Design'], visual:'tile', tone:T.cream },
  { id:'duet-app', name:'Duet App-Controlled Vibrator',cat:'Pleasure', sub:'Vibrators', price:165,
    mood:['Adventurous','Bold','Playful','Energetic'], aud:['Us','A Partner','Date Night'],
    matters:['App-Controlled','Rechargeable','Waterproof','Body-Safe Silicone'], visual:'photo', tone:T.ink },

  // ───── Pleasure / Dildos
  { id:'glass-curve', name:'Glass Curve Dildo',        cat:'Pleasure', sub:'Dildos', price:88,
    mood:['Indulgent','Sensual','Slow & Intimate'], aud:['Me','Solo','Us'],
    matters:['Body-Safe Silicone','Soft-Touch'], visual:'photo', tone:T.amber },
  { id:'silicone-standard', name:'Silicone Standard',  cat:'Pleasure', sub:'Dildos', price:74,
    mood:['Bold','Adventurous'], aud:['Me','Solo','Us','A Partner'],
    matters:['Body-Safe Silicone','Soft-Touch','Rechargeable'], visual:'tile', tone:T.clay },
  { id:'slim-beginner', name:'Slim Beginner Dildo',    cat:'Pleasure', sub:'Dildos', price:52,
    mood:['Curious','Comforting','Playful'], aud:['Me','Solo','Gift'],
    matters:['Beginner-Friendly','First-Time','Body-Safe Silicone','Soft-Touch'], visual:'text', tone:T.cream },

  // ───── Pleasure / For Him
  { id:'ring-trio', name:'Cock Ring Trio',             cat:'Pleasure', sub:'For Him', price:42,
    mood:['Bold','Energetic','Playful'], aud:['Us','A Partner','Date Night'],
    matters:['Body-Safe Silicone','Beginner-Friendly'], visual:'tile', tone:T.ink },
  { id:'prostate-pro', name:'Prostate Massager',       cat:'Pleasure', sub:'For Him', price:98,
    mood:['Indulgent','Adventurous','Unhurried Solo'], aud:['Me','Solo','Us'],
    matters:['Rechargeable','Body-Safe Silicone','Hands-Free'], visual:'photo', tone:T.plum },
  { id:'stroker', name:'Stroker Sleeve',               cat:'Pleasure', sub:'For Him', price:68,
    mood:['Indulgent','Unhurried Solo','Sensual'], aud:['Me','Solo'],
    matters:['Soft-Touch','Body-Safe Silicone'], visual:'text', tone:T.clay },

  // ───── Pleasure / Anal
  { id:'plug-set', name:'Beginner Plug Set',           cat:'Pleasure', sub:'Anal', price:58,
    mood:['Curious','Playful','Comforting'], aud:['Me','Solo','Us','Gift'],
    matters:['Beginner-Friendly','First-Time','Body-Safe Silicone','Soft-Touch'], visual:'tile', tone:T.blush },
  { id:'glass-anal-wand', name:'Glass Anal Wand',      cat:'Pleasure', sub:'Anal', price:84,
    mood:['Indulgent','Sensual','Bold'], aud:['Me','Solo','Us'],
    matters:['Body-Safe Silicone'], visual:'photo', tone:T.amber },
  { id:'vibe-plug', name:'Vibrating Plug',             cat:'Pleasure', sub:'Anal', price:96,
    mood:['Adventurous','Bold','Energetic'], aud:['Me','Solo','A Partner'],
    matters:['Rechargeable','Body-Safe Silicone','Whisper-Quiet'], visual:'tile', tone:T.rose },

  // ───── Play / Bondage & Kink
  { id:'silk-restraints', name:'Silk Restraint Set',   cat:'Play', sub:'Bondage & Kink', price:78,
    mood:['Sensual','Slow & Intimate','Romantic'], aud:['Us','A Partner','Date Night'],
    matters:['Soft-Touch','Beginner-Friendly'], visual:'photo', tone:T.ink },
  { id:'leather-cuffs', name:'Leather Cuff Pair',      cat:'Play', sub:'Bondage & Kink', price:96,
    mood:['Bold','Adventurous'], aud:['Us','A Partner'],
    matters:['Plus-Size-Friendly'], visual:'photo', tone:T.ink },
  { id:'blindfold-feather', name:'Blindfold + Feather',cat:'Play', sub:'Bondage & Kink', price:34,
    mood:['Sensual','Playful','Slow & Intimate','Romantic'], aud:['Us','A Partner','Date Night','Gift'],
    matters:['Beginner-Friendly','First-Time','Soft-Touch'], visual:'tile', tone:T.blush },
  { id:'paddle', name:'Suede Paddle',                  cat:'Play', sub:'Bondage & Kink', price:48,
    mood:['Bold','Adventurous','Energetic'], aud:['Us','A Partner'],
    matters:['Soft-Touch'], visual:'text', tone:T.clay },

  // ───── Play / Couples
  { id:'couples-vibe', name:'Couples Vibrator',        cat:'Play', sub:'Couples', price:189,
    mood:['Sensual','Romantic','Slow & Intimate','Playful'], aud:['Us','A Partner','Date Night'],
    matters:['Rechargeable','Body-Safe Silicone','Waterproof','App-Controlled'], visual:'photo', tone:T.plum },
  { id:'remote-egg', name:'Remote Egg',                cat:'Play', sub:'Couples', price:78,
    mood:['Adventurous','Playful','Curious'], aud:['Us','A Partner','Date Night'],
    matters:['App-Controlled','Whisper-Quiet','Discreet Design','Rechargeable'], visual:'tile', tone:T.rose },
  { id:'connect-ring', name:'Connect Ring',            cat:'Play', sub:'Couples', price:118,
    mood:['Bold','Energetic','Playful'], aud:['Us','A Partner'],
    matters:['App-Controlled','Rechargeable','Body-Safe Silicone'], visual:'photo', tone:T.ink },

  // ───── Body / Lubricants
  { id:'water-glide', name:'Water Glide Lube',         cat:'Body', sub:'Lubricants', price:18,
    mood:['Comforting','Slow & Intimate','Romantic'], aud:['Me','Us','A Partner'],
    matters:['Beginner-Friendly','Body-Safe Silicone','Travel-Size'], visual:'tile', tone:T.cream },
  { id:'silicone-glide', name:'Silicone Glide',        cat:'Body', sub:'Lubricants', price:24,
    mood:['Indulgent','Sensual','Slow & Intimate'], aud:['Me','Us','A Partner'],
    matters:['Waterproof','Travel-Size'], visual:'text', tone:T.amber },
  { id:'warming-glide', name:'Warming Glide',          cat:'Body', sub:'Lubricants', price:22,
    mood:['Sensual','Romantic','Indulgent'], aud:['Us','A Partner','Date Night'],
    matters:['Beginner-Friendly'], visual:'tile', tone:T.rose },

  // ───── Body / Massage
  { id:'massage-candle', name:'Massage Candle',        cat:'Body', sub:'Massage', price:38,
    mood:['Slow & Intimate','Romantic','Sensual','Comforting'], aud:['Us','A Partner','Date Night','Gift'],
    matters:['Soft-Touch'], visual:'photo', tone:T.amber },
  { id:'sensual-oil', name:'Sensual Oil Trio',         cat:'Body', sub:'Massage', price:54,
    mood:['Sensual','Indulgent','Slow & Intimate'], aud:['Us','A Partner','Gift','Date Night'],
    matters:['Travel-Size'], visual:'photo', tone:T.clay },

  // ───── Body / Wellness
  { id:'pelvic-trainer', name:'Pelvic Trainer',        cat:'Body', sub:'Wellness', price:128,
    mood:['Curious','Unhurried Solo'], aud:['Me','Solo'],
    matters:['App-Controlled','Rechargeable','Body-Safe Silicone','Beginner-Friendly'], visual:'tile', tone:T.sage },
  { id:'kegel-set', name:'Weighted Kegel Set',         cat:'Body', sub:'Wellness', price:48,
    mood:['Curious','Comforting','Unhurried Solo'], aud:['Me','Solo'],
    matters:['Beginner-Friendly','First-Time','Body-Safe Silicone'], visual:'text', tone:T.sage },

  // ───── Wear
  { id:'silk-slip', name:'Silk Slip',                  cat:'Wear', sub:'Lingerie', price:148,
    mood:['Sensual','Romantic','Slow & Intimate','Indulgent'], aud:['Us','A Partner','Date Night','Me'],
    matters:['Soft-Touch','Plus-Size-Friendly'], visual:'photo', tone:T.blush },
  { id:'mesh-bodysuit', name:'Mesh Bodysuit',          cat:'Wear', sub:'Lingerie', price:118,
    mood:['Bold','Adventurous','Sensual'], aud:['Me','Us','Date Night'],
    matters:['Plus-Size-Friendly'], visual:'photo', tone:T.ink },
  { id:'lace-set', name:'Lace Bra & Brief',            cat:'Wear', sub:'Lingerie', price:128,
    mood:['Romantic','Sensual','Playful'], aud:['Me','Us','Date Night','Gift'],
    matters:['Soft-Touch'], visual:'photo', tone:T.rose },
  { id:'harness', name:'Vegan Leather Harness',        cat:'Wear', sub:'Accessories', price:96,
    mood:['Bold','Adventurous'], aud:['Us','A Partner'],
    matters:['Plus-Size-Friendly'], visual:'tile', tone:T.ink },
];

// Score a product against current selections. Sum of tag-set intersections.
// 0 selections → everyone is 0 (caller falls back to "browse all" mode).
window.XDIPX_score = function(p, sel) {
  let s = 0;
  for (const m of (sel.mood || []))    if (p.mood.includes(m))    s += 3;
  for (const a of (sel.aud || []))     if (p.aud.includes(a))     s += 2;
  for (const k of (sel.matters || [])) if (p.matters.includes(k)) s += 2;
  return s;
};

// Compose a rail title from the active category + current selection.
// "Sensual Pleasure for Us" / "Slow & Intimate picks in Body"
window.XDIPX_railTitle = function(cat, sel) {
  const mood = (sel.mood || [])[0];
  const aud = (sel.aud || [])[0];
  const matter = (sel.matters || [])[0];
  const moodPart = mood ? mood : '';
  const audPart = aud ? ({Me:'for Me', Us:'for Us', 'A Partner':'for Them', 'Date Night':'for Date Night', Solo:'Solo', Gift:'as a Gift'}[aud] || '') : '';
  if (!moodPart && !audPart && !matter) return cat;
  if (moodPart && audPart) return `${moodPart} ${cat} ${audPart}`;
  if (moodPart) return `${moodPart} ${cat}`;
  if (audPart) return `${cat} ${audPart}`;
  if (matter) return `${matter} ${cat}`;
  return cat;
};

// Compose Emma's adaptive one-liner.
window.XDIPX_emmaLine = function(sel) {
  const m = (sel.mood || [])[0];
  const a = (sel.aud || [])[0];
  const k = (sel.matters || [])[0];
  if (!m && !a && !k) {
    return "Hi, I'm Emma. Tap anything that resonates — there are no wrong answers. I'll help shape what you see.";
  }
  if (m && a && k) {
    return `${m.toLowerCase()}, ${a.toLowerCase()}, and ${k.toLowerCase()} — beautiful brief. I've reshuffled everything below to match.`;
  }
  if (m && a) {
    return `${m.toLowerCase()} for ${a.toLowerCase() === 'me' ? 'you' : a.toLowerCase()} — lovely. Tell me what matters most and I'll narrow further.`;
  }
  if (m)   return `${m.toLowerCase()} — got it. Is this for you, the two of you, or someone else?`;
  if (a)   return `For ${a.toLowerCase()} — noted. What kind of feeling are you after?`;
  if (k)   return `${k.toLowerCase()} matters — good to know. What mood are you in?`;
  return '';
};
