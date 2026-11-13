'use strict';
/*
 * Pagina di ingresso ÆDEN. Fa due cose diverse in base a cosa c'è dopo il # nel link:
 *   …/#E2946757K3J9X2M4QP   codice (8) + segreto (10)   → pagina dell'invitato con il suo QR
 *   …/#AKfycb…              ID del web app del foglio    → pagina dello staff (PIN, fotocamera)
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
  const DURATA_QR = 30;         // secondi, come nel foglio
  const DURATA_ESITO = 10000;   // il risultato di un ingresso resta a schermo 10 secondi
  const FORMATO_ID = /^AKfyc[\w-]{20,200}$/;
  // Impronta (SHA-256) del web app ufficiale della festa. L'indirizzo vero non è scritto qui: dall'impronta
  // non si ricava. Un link fatto con un altro web app (per esempio per farsi dare il PIN) viene riconosciuto.
  const WEB_APP_UFFICIALI = ['663c0927456e1a1db5b119ffb2351c0dfbb66f08716a88a2f50bf307c9d15d7b'];
  const $ = id => document.getElementById(id);

  let API = '';
  let pin = '';
  let daRiprovare = '';    // codice la cui scansione è finita senza risposta: può essere stata segnata lo stesso
  let azione = 'checkin';  // 'checkin' segna l'ingresso, 'controllo' mostra solo le info
  let postazione = Number(leggi('localStorage', 'postazione')) === 2 ? 2 : 1;
  const sessione = leggi('sessionStorage', 'sessione') || nuovaSessione();
  let scanner = null;
  let inVolo = false;
  let ultimo = { codice: '', quando: 0, entrato: false };
  let timerEsito = 0;
  let battito = 0;
  let audio = null;

  function leggi(archivio, chiave) {
    try { return window[archivio].getItem(chiave) || ''; } catch (e) { return ''; }
  }

  function scrivi(archivio, chiave, valore) {
    try { valore ? window[archivio].setItem(chiave, valore) : window[archivio].removeItem(chiave); } catch (e) { /* ignora */ }
  }

  // Ogni scheda del browser conta come un telefono diverso per le postazioni.
  function nuovaSessione() {
    const s = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    scrivi('sessionStorage', 'sessione', s);
    return s;
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

  // Il link dello staff porta l'ID di un web app di Google (o il suo indirizzo completo): il PIN può andare
  // solo lì, mai a un altro sito. In più controllo che sia proprio il web app della festa.
  function paginaStaff(valore) {
    const m = valore.match(/^https:\/\/script\.google\.com\/macros\/s\/([\w-]+)\/exec$/);
    const delLink = m ? m[1] : valore;
    const id = FORMATO_ID.test(delLink) ? delLink : leggi('localStorage', 'api');
    impostaPostazione(postazione);
    if (!FORMATO_ID.test(id)) {
      senzaCollegamento();
      return;
    }
    ufficiale(id).then(si => {
      if (si) {
        scrivi('localStorage', 'api', id);
        collega(id);
        return;
      }
      scrivi('localStorage', 'api', '');  // un collegamento non riconosciuto non resta in memoria
      if (id !== delLink) {
        senzaCollegamento();
        return;
      }
      $('vAvviso').hidden = false;
      $('bContinua').addEventListener('click', () => {
        $('vAvviso').hidden = true;
        collega(id);
      }, { once: true });
    });
  }

  function ufficiale(id) {
    return Promise.resolve()
      .then(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))
      .then(buf => WEB_APP_UFFICIALI.includes(Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')))
      .catch(() => false);
  }

  function senzaCollegamento() {
    $('vAccesso').hidden = false;
    $('fAccesso').hidden = true;
    $('sceltaPostazione').hidden = true;
    $('msgAccesso').textContent = 'Manca il collegamento al foglio: apri il link che ti hanno mandato.';
  }

  function collega(id) {
    API = `https://script.google.com/macros/s/${id}/exec`;
    $('vAccesso').hidden = false;
    pin = leggi('sessionStorage', 'pin');
    if (pin) accedi(pin);
    else statoPostazioni();
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
    chiama({ azione: 'login', pin: valore, postazione, sessione })
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
    aggiornaPostazione(r);
    clearInterval(battito);
    battito = setInterval(presenza, 60000);
    tieniSchermoAcceso();
    impostaAzione('checkin');
    avviaCamera();
  }

  function esci(msg) {
    clearInterval(battito);
    pin = '';
    scrivi('sessionStorage', 'pin', '');
    fermaCamera();
    chiudi();
    $('vScanner').hidden = true;
    $('vAccesso').hidden = false;
    $('fAccesso').hidden = false;
    $('sceltaPostazione').hidden = false;
    $('pin').value = '';
    $('msgAccesso').textContent = msg || '';
    statoPostazioni();
  }

  function impostaAzione(a) {
    azione = a;
    $('bIngresso').classList.toggle('attivo', a === 'checkin');
    $('bControllo').classList.toggle('attivo', a === 'controllo');
    $('avvisoControllo').hidden = a !== 'controllo';
    ultimo = { codice: '', quando: 0, entrato: false };
  }

  /* ---------- Postazioni: 1 scrive in Ricerca nome 1 (B27), 2 in Ricerca nome 2 (L27) ---------- */

  function impostaPostazione(n) {
    postazione = n === 2 ? 2 : 1;
    scrivi('localStorage', 'postazione', String(postazione));
    $('bPost1').classList.toggle('attivo', postazione === 1);
    $('bPost2').classList.toggle('attivo', postazione === 2);
    $('postazioneAttiva').textContent = `Postazione ${postazione} · Ricerca nome ${postazione}`;
  }

  // Prima del PIN il foglio dice quali postazioni usa già un altro telefono: propongo quella libera.
  function statoPostazioni() {
    if (!API) return;
    chiama({ azione: 'stato', sessione })
      .then(r => {
        const occupate = Array.isArray(r.occupate) ? r.occupate : [];
        [1, 2].forEach(n => { $(`bPost${n}`).querySelector('.stato').textContent = occupate.includes(n) ? 'già in uso' : ''; });
        const altra = postazione === 1 ? 2 : 1;
        if (occupate.includes(postazione) && !occupate.includes(altra)) impostaPostazione(altra);
      })
      .catch(() => {});
  }

  // Il foglio conferma la postazione (o la cambia, se l'altra era già presa) e avvisa dei conflitti.
  function aggiornaPostazione(r) {
    if (r.postazione) impostaPostazione(r.postazione);
    $('avvisoPostazione').textContent = r.avviso || '';
    $('avvisoPostazione').hidden = !r.avviso;
  }

  // Ogni minuto il telefono si fa sentire: dopo 3 minuti di silenzio la postazione si libera.
  function presenza() {
    if (!pin || $('vScanner').hidden) return;
    chiama({ azione: 'presenza', pin, postazione, sessione })
      .then(r => (r.esito === 'pin' ? esci(r.msg) : aggiornaPostazione(r)))
      .catch(() => {});
  }

  /* ---------- Fotocamera ---------- */

  function avviaCamera() {
    $('msgScanner').textContent = '';
    $('bCamera').hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      erroreCamera(spiegaErroreCamera(''));
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
        return scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: riquadro }, testo => nuovoCodice(testo), () => {});
      }, () => {
        throw new Error('Scanner non caricato: controlla la connessione e ricarica la pagina.');
      })
      .catch(err => erroreCamera(err instanceof Error && /^Scanner/.test(err.message) ? err.message : spiegaErroreCamera(err)));
  }

  function erroreCamera(msg) {
    $('lettore').hidden = true;
    $('msgScanner').textContent = msg;
    $('bCamera').hidden = false;
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
      return 'Permesso fotocamera negato: consentilo per questo sito (tocca il lucchetto o "aA" accanto all\'indirizzo) e premi Riavvia fotocamera.';
    }
    if (/NotFound|not found/i.test(e)) return 'Nessuna fotocamera trovata su questo dispositivo.';
    if (/NotReadable|Could not start/i.test(e)) return 'La fotocamera è occupata da un\'altra app: chiudila e premi Riavvia fotocamera.';
    return `Fotocamera non disponibile (${e}).`;
  }

  function normalizza(testo) {
    return String(testo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function nuovoCodice(testo) {
    const contenuto = normalizza(testo);
    // Finché il risultato è a schermo la fotocamera non legge altri QR: si va avanti toccando lo schermo.
    if (!contenuto || inVolo || !$('esito').hidden) return;
    const codice = contenuto.slice(0, 8);  // la firma cambia ogni 30 secondi: conta il codice
    if (codice === ultimo.codice) {
      // La fotocamera rilegge lo stesso QR finché resta inquadrato: chi è appena entrato
      // non deve diventare "già entrato" solo perché tiene il telefono alzato.
      const finestra = ultimo.entrato ? 30000 : 4000;
      if (Date.now() - ultimo.quando < finestra) return;
    }
    controlla(contenuto);
  }

  function controlla(contenuto) {
    inVolo = true;
    const codice = contenuto.slice(0, 8);
    const segna = azione === 'checkin';
    ultimo = { codice, quando: Date.now(), entrato: false };
    mostraEsito('attesa', ['titolo', '⏳'], ['det', codice]);
    const dati = { azione, pin, codice: contenuto, postazione, sessione };
    if (segna && daRiprovare === codice) dati.riprova = true;
    chiama(dati)
      .catch(() => ({ esito: 'errore', rete: true, msg: 'Nessuna risposta dal foglio: controlla la connessione e riprova.' }))
      .then(r => {
        inVolo = false;
        // Senza risposta l'ingresso può essere stato segnato lo stesso. Alla prossima scansione di questo QR
        // lo dico al foglio: se l'aveva segnato questo telefono risponde "entra", non "già entrato".
        if (r.rete) {
          if (segna) daRiprovare = codice;
        } else if (r.esito !== 'errore') {
          daRiprovare = '';
        }
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
    if (r.postazione) aggiornaPostazione(r);
    ultimo.entrato = r.esito === 'ok';
    const minorenne = /minorenn/i.test(r.eta || '');
    const pagato = /^si$/i.test(String(r.pagato || '').trim());
    const eta = minorenne ? ['badge', '⚠ MINORENNE'] : ['det', r.eta || 'Età non indicata'];
    const parti = [];
    let tipo;
    if (r.esito === 'ok') {
      tipo = minorenne || !pagato ? 'avviso' : 'ok';
      parti.push(['titolo', '✔ ENTRA'], ['nome', r.nome], eta);
      if (!pagato) parti.push(['badge', '⚠ NON RISULTA PAGATO']);
      parti.push(['det', `Guardaroba: ${r.guardaroba || '—'}`]);
    } else if (r.esito === 'gia') {
      tipo = 'no';
      parti.push(['titolo', '✖ GIÀ ENTRATO'], ['nome', r.nome], ['det', r.ora ? `alle ${r.ora}` : 'ora non registrata']);
    } else if (r.esito === 'scaduto') {
      tipo = 'no';
      parti.push(['titolo', '✖ QR SCADUTO'], ['nome', r.nome], ['det', 'Sembra uno screenshot vecchio: fai aprire il link dell\'SMS.']);
    } else if (r.esito === 'vecchio') {
      tipo = 'no';
      parti.push(['titolo', '✖ QR NON VALIDO'], ['nome', r.nome], ['det', 'Non è il QR della pagina: fai aprire il link dell\'SMS.']);
    } else if (r.esito === 'controllo') {
      tipo = 'controllo';
      parti.push(['titolo', '🔍 CONTROLLO'], ['nome', r.nome], eta);
      parti.push(pagato ? ['det', `Pagato: Si${dettagliPagamento(r)}`] : ['badge', '⚠ NON RISULTA PAGATO']);
      parti.push(['det', `Guardaroba: ${r.guardaroba || '—'}`]);
      parti.push(['det', r.entrato ? `Ingresso: già entrato${r.ora ? ` alle ${r.ora}` : ''}` : 'Ingresso: non ancora entrato']);
      parti.push(['det', 'Confronta il nome con il documento']);
    } else if (r.esito === 'sconosciuto') {
      tipo = 'no';
      parti.push(['titolo', '✖ QR NON VALIDO'], ['det', `Codice: ${r.codice || '—'}`], ['det', 'Non è nella lista: cerca il nome a mano.']);
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
    if (tipo !== 'controllo') timerEsito = setTimeout(chiudi, DURATA_ESITO);
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
  $('bPost1').addEventListener('click', () => impostaPostazione(1));
  $('bPost2').addEventListener('click', () => impostaPostazione(2));
  $('bEsci').addEventListener('click', () => {
    // libera subito la postazione, così l'altro telefono la può prendere
    chiama({ azione: 'libera', pin, postazione, sessione }).catch(() => {});
    esci('');
  });
  $('bIngresso').addEventListener('click', () => impostaAzione('checkin'));
  $('bControllo').addEventListener('click', () => impostaAzione('controllo'));
  $('bCamera').addEventListener('click', () => { sbloccaAudio(); avviaCamera(); });
  $('esito').addEventListener('click', chiudi);
  // Suono e vibrazione partono solo dopo un tocco: se la pagina si è riaperta da sola basta toccarla una volta.
  document.addEventListener('pointerdown', sbloccaAudio, { once: true });
  // Quando lo schermo si spegne il telefono chiude la fotocamera: al ritorno la riapro.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || $('vScanner').hidden) return;
    tieniSchermoAcceso();
    presenza();
    if (scanner && scanner.isScanning) scanner.stop().catch(() => {}).then(avviaCamera);
    else avviaCamera();
  });

  /* ---------- Avvio ---------- */

  // Un altro link aperto nella stessa scheda cambia solo la parte dopo il #: ricarico da capo.
  window.addEventListener('hashchange', () => location.reload());

  let dopoCancelletto = '';
  try {
    dopoCancelletto = decodeURIComponent(location.hash.slice(1)).trim();
  } catch (e) { /* link rovinato: vale come nessun link */ }
  const maiuscolo = dopoCancelletto.toUpperCase();
  if (FORMATO_INVITATO.test(maiuscolo)) paginaInvitato(maiuscolo);
  else if (FORMATO_CODICE.test(maiuscolo)) linkVecchio();  // link col solo codice: non vale più
  else paginaStaff(dopoCancelletto);
})();
