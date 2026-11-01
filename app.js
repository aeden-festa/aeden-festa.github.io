'use strict';
/*
 * Pagina di ingresso ÆDEN. Fa due cose diverse in base a cosa c'è dopo il # nel link:
 *   …/#E2946757K3J9X2M4QP   codice (8) + segreto (10)   → pagina dell'invitato con il suo QR
 *   …/#AKfycb…              ID del web app del foglio    → pagina dello staff (PIN, scanner)
 * Quello che sta dopo il # non viene mai mandato a nessun server.
 */
(function () {
  // Niente pagina dentro un'altra pagina: un sito estraneo non può "travestirla".
  if (window.top !== window.self) {
    document.body.textContent = '';
    return;
  }

  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const FORMATO_CODICE = new RegExp(`^[${ALFABETO}]{8}$`);
  const FORMATO_INVITATO = new RegExp(`^[${ALFABETO}]{18}$`);
  const DURATA_QR = 30;  // secondi, come nel foglio
  const FORMATO_ID = /^AKfyc[\w-]{20,200}$/;
  // Web app che non valgono più (il foglio di prova): un telefono che li ha salvati li dimentica.
  const ID_RITIRATI = ['AKfycbx8Dfj3CezchOj947DcTevJOnEvQrMvvCbwwKRz9DC2yzOZNmfdDkVolDemE5LuK6b7yg'];
  const $ = id => document.getElementById(id);

  let API = '';
  let pin = '';
  let azione = 'checkin';  // 'checkin' segna l'ingresso, 'controllo' mostra solo le info
  let modo = '';           // 'camera' o 'lettore'
  let scanner = null;
  let inVolo = false;
  let ultimo = { codice: '', quando: 0, entrato: false };
  let timerEsito = 0;
  let audio = null;

  function leggi(archivio, chiave) {
    try { return window[archivio].getItem(chiave) || ''; } catch (e) { return ''; }
  }

  function scrivi(archivio, chiave, valore) {
    try { valore ? window[archivio].setItem(chiave, valore) : window[archivio].removeItem(chiave); } catch (e) { /* ignora */ }
  }

  function caricaScript(src) {
    return new Promise((fatto, errore) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = fatto;
      s.onerror = errore;
      document.head.appendChild(s);
    });
  }

  /* ---------- Pagina dell'invitato ---------- */

  // Il QR contiene il codice più una firma che cambia ogni 30 secondi: uno screenshot scade presto.
  function paginaInvitato(valore) {
    document.title = 'Il tuo QR · ÆDEN';
    $('vInvitato').hidden = false;
    const codice = valore.slice(0, 8);
    Promise.all([caricaScript('vendor/qrcode-generator.js'), differenzaOrologio(), chiaveFirma(valore.slice(8))])
      .then(([, scarto, chiave]) => {
        let mostrata = -1;
        const aggiorna = () => {
          const finestra = Math.floor((Date.now() + scarto) / 1000 / DURATA_QR);
          if (finestra === mostrata) return;
          mostrata = finestra;
          firma(chiave, finestra).then(f => {
            const qr = window.qrcode(0, 'M');
            qr.addData(codice + f);
            qr.make();
            $('qr').replaceChildren(disegnaQR(qr));
          });
        };
        aggiorna();
        setInterval(aggiorna, 1000);
      })
      .catch(() => {
        $('qr').hidden = true;
        $('msgInvitato').textContent = 'Non riesco a mostrare il QR: aggiorna il browser, oppure all\'ingresso fatti cercare per nome.';
      });
  }

  function linkVecchio() {
    document.title = 'ÆDEN';
    $('vInvitato').hidden = false;
    $('qr').hidden = true;
    $('msgInvitato').textContent = 'Questo link non vale più: apri quello dell\'ultimo SMS.';
  }

  function chiaveFirma(segreto) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(segreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }

  function firma(chiave, finestra) {
    return crypto.subtle.sign('HMAC', chiave, new TextEncoder().encode(String(finestra)))
      .then(buf => Array.from(new Uint8Array(buf).slice(0, 6), b => ALFABETO.charAt(b & 31)).join(''));
  }

  // Il QR dipende dall'ora: uso quella del server, nel caso l'orologio del telefono sia sbagliato.
  function differenzaOrologio() {
    const prima = Date.now();
    return fetch(`${location.pathname}?ora=${prima}`, { method: 'HEAD', cache: 'no-store' })
      .then(r => {
        const server = Date.parse(r.headers.get('Date'));
        const scarto = server + 500 - (prima + Date.now()) / 2;  // l'ora del server è al secondo
        return Number.isFinite(scarto) && Math.abs(scarto) < 3600000 ? scarto : 0;
      })
      .catch(() => 0);
  }

  function disegnaQR(qr) {
    const NS = 'http://www.w3.org/2000/svg';
    const n = qr.getModuleCount();
    const bordo = 4;  // margine bianco richiesto dallo standard QR
    const lato = n + bordo * 2;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${lato} ${lato}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code per l\'ingresso');
    const sfondo = document.createElementNS(NS, 'rect');
    sfondo.setAttribute('width', lato);
    sfondo.setAttribute('height', lato);
    sfondo.setAttribute('fill', '#fff');
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + bordo} ${r + bordo}h1v1h-1z`;
    }
    const moduli = document.createElementNS(NS, 'path');
    moduli.setAttribute('d', d);
    moduli.setAttribute('fill', '#000');
    svg.append(sfondo, moduli);
    return svg;
  }

  /* ---------- Pagina dello staff ---------- */

  function paginaStaff(valore) {
    const id = idWebApp(valore);
    $('vAccesso').hidden = false;
    if (!id) {
      $('fAccesso').hidden = true;
      $('msgAccesso').textContent = 'Manca il collegamento al foglio (o è quello vecchio di prova): apri il link nuovo che ti hanno mandato.';
      return;
    }
    API = `https://script.google.com/macros/s/${id}/exec`;
    // Si vede subito se il telefono sta usando il foglio giusto.
    $('collegato').textContent = `Foglio collegato: …${id.slice(-4)}`;
    pin = leggi('sessionStorage', 'pin');
    if (pin) accedi(pin);
  }

  // Accetta solo l'ID di un web app di Google (o il suo indirizzo completo):
  // un link modificato non può far mandare il PIN a un altro sito.
  function idWebApp(valore) {
    const m = valore.match(/^https:\/\/script\.google\.com\/macros\/s\/([\w-]+)\/exec$/);
    let id = m ? m[1] : valore;
    if (FORMATO_ID.test(id) && !ID_RITIRATI.includes(id)) scrivi('localStorage', 'api', id);
    else id = leggi('localStorage', 'api');
    if (ID_RITIRATI.includes(id)) {
      scrivi('localStorage', 'api', '');
      return '';
    }
    return FORMATO_ID.test(id) ? id : '';
  }

  function chiama(dati) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    // Corpo come testo semplice: niente richiesta preliminare CORS verso Google.
    return fetch(API, { method: 'POST', body: JSON.stringify(dati), signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(r => r.json())
      .finally(() => clearTimeout(timer));
  }

  function accedi(valore) {
    $('msgAccesso').textContent = 'Controllo…';
    chiama({ azione: 'login', pin: valore })
      .then(r => {
        if (r.esito !== 'ok') {
          esci(r.msg || 'Errore');
          return;
        }
        pin = valore;
        scrivi('sessionStorage', 'pin', valore);
        avvia(r);
      })
      .catch(() => { $('msgAccesso').textContent = 'Il foglio non risponde: controlla la connessione e che il link sia quello giusto.'; });
  }

  function avvia(r) {
    $('msgAccesso').textContent = '';
    $('vAccesso').hidden = true;
    $('vScanner').hidden = false;
    $('titolo').textContent = `Ingresso ${r.festa || ''}`;
    aggiornaConteggio(r.conteggio);
    tieniSchermoAcceso();
    impostaAzione('checkin');
    imposta(navigator.maxTouchPoints > 0 || 'ontouchstart' in window ? 'camera' : 'lettore');
  }

  function esci(msg) {
    pin = '';
    scrivi('sessionStorage', 'pin', '');
    fermaCamera();
    chiudi();
    $('vScanner').hidden = true;
    $('vAccesso').hidden = false;
    $('fAccesso').hidden = false;
    $('pin').value = '';
    $('msgAccesso').textContent = msg || '';
  }

  function impostaAzione(a) {
    azione = a;
    $('bIngresso').classList.toggle('attivo', a === 'checkin');
    $('bControllo').classList.toggle('attivo', a === 'controllo');
    $('avvisoControllo').hidden = a !== 'controllo';
    ultimo = { codice: '', quando: 0, entrato: false };
    if (modo === 'lettore') $('codice').focus();
  }

  /* ---------- Fotocamera e lettore ---------- */

  function imposta(m) {
    modo = m;
    $('bCamera').classList.toggle('attivo', m === 'camera');
    $('bLettore').classList.toggle('attivo', m === 'lettore');
    $('msgScanner').textContent = '';
    if (m === 'camera') {
      avviaCamera();
    } else {
      fermaCamera();
      $('codice').focus();
    }
  }

  function avviaCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('msgScanner').textContent = spiegaErroreCamera('');
      return;
    }
    const pronto = window.Html5Qrcode ? Promise.resolve() : caricaScript('vendor/html5-qrcode.min.js');
    pronto
      .then(() => {
        // Il riquadro deve essere visibile prima di avviare: la libreria ne misura la larghezza.
        $('lettore').hidden = false;
        if (!scanner) scanner = new window.Html5Qrcode('lettore', { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
        if (scanner.isScanning) return null;
        const riquadro = (w, h) => {
          const lato = Math.max(150, Math.floor(Math.min(w, h) * 0.7));
          return { width: lato, height: lato };
        };
        return scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: riquadro }, testo => nuovoCodice(testo, false), () => {});
      }, () => {
        throw new Error('Scanner non caricato: controlla la connessione e ricarica la pagina.');
      })
      .catch(err => {
        $('lettore').hidden = true;
        $('msgScanner').textContent = err instanceof Error && /^Scanner/.test(err.message) ? err.message : spiegaErroreCamera(err);
      });
  }

  function fermaCamera() {
    $('lettore').hidden = true;
    if (scanner && scanner.isScanning) scanner.stop().catch(() => {});
  }

  function spiegaErroreCamera(err) {
    const e = String(err || '');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return 'Questo browser non può usare la fotocamera: apri il link con Chrome (Android) o Safari (iPhone), non dentro l\'app di Fogli o WhatsApp.';
    }
    if (/NotAllowed|Permission/i.test(e)) {
      return 'Permesso fotocamera negato: consentilo per questo sito (tocca il lucchetto o "aA" accanto all\'indirizzo) e premi di nuovo 📷 Fotocamera.';
    }
    if (/NotFound|not found/i.test(e)) return 'Nessuna fotocamera trovata su questo dispositivo: scrivi il codice.';
    if (/NotReadable|Could not start/i.test(e)) return 'La fotocamera è occupata da un\'altra app: chiudila e premi di nuovo 📷 Fotocamera.';
    return `Fotocamera non disponibile (${e}): scrivi il codice.`;
  }

  function normalizza(testo) {
    return String(testo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // daTastiera: scritto a mano o dal lettore USB. Solo così vale anche il codice senza firma.
  function nuovoCodice(testo, daTastiera) {
    const contenuto = normalizza(testo);
    if (!contenuto || inVolo) return;
    const codice = contenuto.slice(0, 8);  // la firma cambia ogni 30 secondi: conta il codice
    if (codice === ultimo.codice) {
      // La fotocamera rilegge lo stesso QR finché resta inquadrato: chi è appena entrato
      // non deve diventare "già entrato" solo perché tiene il telefono alzato.
      const finestra = ultimo.entrato ? 30000 : 4000;
      if (!$('esito').hidden || Date.now() - ultimo.quando < finestra) return;
    }
    controlla(contenuto, daTastiera);
  }

  function controlla(contenuto, daTastiera) {
    inVolo = true;
    ultimo = { codice: contenuto.slice(0, 8), quando: Date.now(), entrato: false };
    mostraEsito('attesa', ['titolo', '⏳'], ['det', contenuto.slice(0, 8)]);
    chiama({ azione, pin, codice: contenuto, manuale: daTastiera })
      .catch(() => ({ esito: 'errore', msg: 'Nessuna risposta dal foglio: controlla la connessione e riprova.' }))
      .then(r => {
        inVolo = false;
        risultato(r);
      });
  }

  /* ---------- Esito ---------- */

  function risultato(r) {
    if (r.esito === 'pin') {
      esci(r.msg);
      return;
    }
    if (r.conteggio) aggiornaConteggio(r.conteggio);
    ultimo.entrato = r.esito === 'ok';
    const minorenne = /minorenn/i.test(r.eta || '');
    const pagato = /^si$/i.test(String(r.pagato || '').trim());
    const eta = minorenne ? ['badge', '⚠ MINORENNE'] : ['det', r.eta || 'Età non indicata'];
    const aMano = r.manuale ? ['badge', '⌨️ CODICE A MANO: controlla bene il documento'] : null;
    const parti = [];
    let tipo;
    if (r.esito === 'ok') {
      tipo = minorenne || !pagato || r.manuale ? 'avviso' : 'ok';
      parti.push(['titolo', '✔ ENTRA'], ['nome', r.nome], eta);
      if (!pagato) parti.push(['badge', '⚠ NON RISULTA PAGATO']);
      if (aMano) parti.push(aMano);
      parti.push(['det', `Guardaroba: ${r.guardaroba || '—'}`]);
    } else if (r.esito === 'scaduto') {
      tipo = 'no';
      parti.push(['titolo', '✖ QR SCADUTO'], ['nome', r.nome], ['det', 'Sembra uno screenshot o una pagina vecchia: fai riaprire il link dell\'SMS.']);
    } else if (r.esito === 'vecchio') {
      tipo = 'no';
      parti.push(['titolo', '✖ QR NON VALIDO'], ['nome', r.nome], ['det', 'Non è il QR della pagina (che cambia ogni 30 secondi): fai aprire il link dell\'SMS.']);
    } else if (r.esito === 'gia') {
      tipo = 'no';
      parti.push(['titolo', '✖ GIÀ ENTRATO'], ['nome', r.nome], ['det', r.ora ? `alle ${r.ora}` : 'ora non registrata']);
    } else if (r.esito === 'controllo') {
      tipo = 'controllo';
      parti.push(['titolo', '🔍 CONTROLLO'], ['nome', r.nome], eta);
      parti.push(pagato ? ['det', `Pagato: Si${dettagliPagamento(r)}`] : ['badge', '⚠ NON RISULTA PAGATO']);
      parti.push(['det', `Guardaroba: ${r.guardaroba || '—'}`]);
      parti.push(['det', r.entrato ? `Ingresso: già entrato${r.ora ? ` alle ${r.ora}` : ''}` : 'Ingresso: non ancora entrato']);
      if (aMano) parti.push(aMano);
      parti.push(['det', 'Confronta il nome con il documento']);
    } else if (r.esito === 'sconosciuto') {
      tipo = 'no';
      parti.push(['titolo', '✖ QR NON VALIDO'], ['det', `Codice: ${r.codice || '—'}`], ['det', 'Non è nella lista: controlla a mano.']);
    } else {
      tipo = 'errore';
      ultimo.codice = '';  // si può riprovare subito
      parti.push(['titolo', 'Errore'], ['det', r.msg || 'Riprova.']);
    }
    parti.push(['piccolo', 'Tocca per continuare']);
    mostraEsito(tipo, ...parti);
    if (tipo !== 'errore') registra(r, tipo);
    segnale(tipo);
    clearTimeout(timerEsito);
    // il controllo resta a schermo finché non lo chiudi, per confrontarlo con il documento
    if (tipo !== 'controllo') timerEsito = setTimeout(chiudi, tipo === 'ok' ? 2000 : 4000);
  }

  function dettagliPagamento(r) {
    const pezzi = [];
    if (r.quanto) pezzi.push(`${r.quanto} €`);
    if (r.aChi) pezzi.push(`a ${r.aChi}`);
    if (r.tramite) pezzi.push(`(${r.tramite})`);
    return pezzi.length ? ` — ${pezzi.join(' ')}` : '';
  }

  function mostraEsito(tipo, ...parti) {
    const box = $('esito');
    box.className = tipo;
    box.replaceChildren(...parti.filter(([, testo]) => testo).map(([classe, testo]) => {
      const d = document.createElement('div');
      d.className = classe;
      d.textContent = testo;
      return d;
    }));
    box.hidden = false;
  }

  function chiudi() {
    clearTimeout(timerEsito);
    if (inVolo) return;
    $('esito').hidden = true;
    ultimo.quando = Date.now();
    if (modo === 'lettore' && !$('vScanner').hidden) $('codice').focus();
  }

  function registra(r, tipo) {
    const li = document.createElement('li');
    const chi = document.createElement('span');
    const nota = { gia: ' (già entrato)', controllo: ' (controllo)', scaduto: ' (QR scaduto)', vecchio: ' (QR non valido)' }[r.esito] || '';
    chi.textContent = `${{ ok: '✔', avviso: '⚠', no: '✖', controllo: '🔍' }[tipo]} ${r.nome || r.codice || ''}${nota}`;
    const ora = document.createElement('span');
    ora.className = 'ora';
    ora.textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    li.append(chi, ora);
    const lista = $('ultimi');
    lista.prepend(li);
    while (lista.children.length > 6) lista.lastChild.remove();
  }

  function aggiornaConteggio(c) {
    if (!c) return;
    const b = document.createElement('b');
    b.textContent = c.entrati;
    $('conteggio').replaceChildren('Entrati ', b, ` / ${c.totale}`);
  }

  /* ---------- Suono, vibrazione, schermo acceso ---------- */

  function sbloccaAudio() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
    } catch (e) { audio = null; }
  }

  function segnale(tipo) {
    const bene = tipo === 'ok' || tipo === 'controllo';
    if (navigator.vibrate) navigator.vibrate(bene ? 120 : [250, 120, 250]);
    if (!audio) return;
    (bene ? [880] : [220, 220]).forEach((freq, i) => {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      const t = audio.currentTime + i * 0.25;
      osc.frequency.value = freq;
      osc.connect(vol).connect(audio.destination);
      vol.gain.setValueAtTime(0.2, t);
      vol.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  function tieniSchermoAcceso() {
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  }

  /* ---------- Collegamenti ai pulsanti ---------- */

  $('fAccesso').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('pin').value.trim();
    if (!v) return;
    sbloccaAudio();
    accedi(v);
  });
  $('bEsci').addEventListener('click', () => esci(''));
  $('bIngresso').addEventListener('click', () => impostaAzione('checkin'));
  $('bControllo').addEventListener('click', () => impostaAzione('controllo'));
  $('bCamera').addEventListener('click', () => { sbloccaAudio(); imposta('camera'); });
  $('bLettore').addEventListener('click', () => { sbloccaAudio(); imposta('lettore'); });
  $('esito').addEventListener('click', chiudi);
  $('fCodice').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('codice').value;
    $('codice').value = '';
    nuovoCodice(v, true);
  });
  // Col lettore USB il campo deve restare sempre selezionato.
  $('codice').addEventListener('blur', () => {
    setTimeout(() => {
      if (modo === 'lettore' && !$('vScanner').hidden && document.activeElement !== $('codice')) $('codice').focus();
    }, 300);
  });
  // Quando lo schermo si spegne il telefono chiude la fotocamera: al ritorno la riapro.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || $('vScanner').hidden) return;
    tieniSchermoAcceso();
    if (modo !== 'camera') return;
    if (scanner && scanner.isScanning) scanner.stop().catch(() => {}).then(avviaCamera);
    else avviaCamera();
  });

  /* ---------- Avvio ---------- */

  // Un altro link aperto nella stessa scheda cambia solo la parte dopo il #: ricarico da capo.
  window.addEventListener('hashchange', () => location.reload());

  const dopoCancelletto = decodeURIComponent(location.hash.slice(1)).trim();
  const maiuscolo = dopoCancelletto.toUpperCase();
  if (FORMATO_INVITATO.test(maiuscolo)) paginaInvitato(maiuscolo);
  else if (FORMATO_CODICE.test(maiuscolo)) linkVecchio();  // link di prova, prima del QR dinamico
  else paginaStaff(dopoCancelletto);
})();
