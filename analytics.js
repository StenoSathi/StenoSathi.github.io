/**
 * ============================================================
 *  STENO SATHI — Analytics & Data Goldmine Engine
 *  analytics.js  |  v2.0  |  Supabase-powered
 * ============================================================
 *
 *  Collects rich behavioural data from every visitor and
 *  flushes it to Supabase on session end (pagehide/beforeunload).
 *  Also maintains a local localStorage aggregate for instant
 *  fallback if the network call fails.
 *
 * ============================================================
 */

;(function () {
  'use strict';

  // ─── Supabase Config ─────────────────────────────────────────
  var SUPABASE_URL = 'https://fgzrdujqgfzkdugvkemt.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnenJkdWpxZ2Z6a2R1Z3ZrZW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4Njc2ODMsImV4cCI6MjA5MzQ0MzY4M30.hC99YGeKEALsnFpLxgkbXVciUytMfFdH7vK5B3U2Zu8';
  var TABLE        = 'sessions';

  // ─── Local Storage Keys (fallback) ───────────────────────────
  var STORAGE_KEY   = 'ss_analytics';
  var AGGREGATE_KEY = 'ss_aggregate';
  var MAX_SESSIONS  = 200;

  // ─── Utilities ───────────────────────────────────────────────
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function nowIST() {
    var now = new Date();
    var istOffset = 5.5 * 60 * 60 * 1000;
    return new Date(now.getTime() + istOffset - now.getTimezoneOffset() * 60000);
  }

  function getOrCreate(key, def) {
    try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : def; }
    catch (e) { return def; }
  }

  function save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  function getUTMParams() {
    var p = {}; var s = new URLSearchParams(window.location.search);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){
      var v = s.get(k); if (v) p[k.replace('utm_','')] = v;
    });
    return p;
  }

  function getDeviceType() {
    var ua = navigator.userAgent;
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile';
    if (/Tablet|iPad/i.test(ua)) return 'tablet';
    return 'desktop';
  }

  function getBrowser() {
    var ua = navigator.userAgent;
    if (/OPR|Opera/i.test(ua)) return 'Opera';
    if (/Edg/i.test(ua)) return 'Edge';
    if (/Chrome/i.test(ua)) return 'Chrome';
    if (/Firefox/i.test(ua)) return 'Firefox';
    if (/Safari/i.test(ua)) return 'Safari';
    return 'Other';
  }

  function getOS() {
    var ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Other';
  }

  function getConnectionType() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return c ? (c.effectiveType || c.type || 'unknown') : 'unknown';
  }

  function getOrSetVisitorId() {
    var vid = localStorage.getItem('ss_visitor_id');
    if (!vid) { vid = uid(); localStorage.setItem('ss_visitor_id', vid); }
    return vid;
  }

  function isReturning() { return !!localStorage.getItem('ss_visitor_id'); }

  // ─── Session Bootstrap ────────────────────────────────────────
  var pageLoadStart = performance.now();
  var istNow        = nowIST();
  var returning     = isReturning();
  var visitorId     = getOrSetVisitorId();

  var session = {
    session_id:              uid(),
    visitor_id:              visitorId,
    is_returning:            returning,
    date_ist:                istNow.toISOString().slice(0,10),
    hour_ist:                istNow.getHours(),
    day_of_week:             ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][istNow.getDay()],
    referrer:                document.referrer || 'direct',
    utm:                     getUTMParams(),
    device:                  getDeviceType(),
    os:                      getOS(),
    browser:                 getBrowser(),
    screen_res:              window.screen.width + 'x' + window.screen.height,
    viewport:                window.innerWidth + 'x' + window.innerHeight,
    connection_type:         getConnectionType(),
    language:                navigator.language || 'unknown',
    page_load_ms:            null,
    session_duration_sec:    null,
    duration_bucket:         null,
    max_scroll_depth:        0,
    scroll_milestones:       [],
    sections_viewed:         [],
    time_per_section:        {},
    pricing_cards_hovered:   {},
    service_cards_viewed:    [],
    testimonial_viewed:      false,
    countdown_timer_seen:    false,
    cta_clicks:              [],
    whatsapp_clicks:         0,
    callback_form_clicks:    0,
    email_clicks:            0,
    exit_intent_fired:       false,
    exit_intent_scroll_pct:  null,
    exit_section:            null,
    rage_clicks:             [],
    copy_events:             0,
    phone_number_copied:     false,
    email_address_copied:    false,
  };

  window.addEventListener('load', function () {
    session.page_load_ms = Math.round(performance.now() - pageLoadStart);
  });

  // ─── Scroll Depth ─────────────────────────────────────────────
  var milestones = [25, 50, 75, 90, 100];
  window.addEventListener('scroll', function () {
    var st = window.scrollY || document.documentElement.scrollTop;
    var dh = document.documentElement.scrollHeight - window.innerHeight;
    var pct = dh > 0 ? Math.round((st / dh) * 100) : 0;
    if (pct > session.max_scroll_depth) session.max_scroll_depth = pct;
    milestones.forEach(function(m){
      if (pct >= m && session.scroll_milestones.indexOf(m) === -1)
        session.scroll_milestones.push(m);
    });
  }, { passive: true });

  // ─── Section Visibility & Time-per-Section ────────────────────
  var currentSection = null, sectionEnterTime = null;

  if ('IntersectionObserver' in window) {
    var secObs = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        var id = entry.target.id || 'header';
        if (entry.isIntersecting) {
          if (session.sections_viewed.indexOf(id) === -1) session.sections_viewed.push(id);
          session.exit_section = id;
          currentSection = id; sectionEnterTime = Date.now();
          if (id === 'testimonials') session.testimonial_viewed = true;
        } else {
          if (currentSection === id && sectionEnterTime) {
            var spent = Math.round((Date.now() - sectionEnterTime) / 1000);
            session.time_per_section[id] = (session.time_per_section[id] || 0) + spent;
            currentSection = null; sectionEnterTime = null;
          }
        }
      });
    }, { threshold: 0.4 });

    document.querySelectorAll('section[id], header').forEach(function(el){
      if (!el.id) el.id = 'header';
      secObs.observe(el);
    });

    // Countdown banner
    var banner = document.querySelector('.sale-banner');
    if (banner) {
      var bObs = new IntersectionObserver(function(e){
        if (e[0].isIntersecting) session.countdown_timer_seen = true;
      }, { threshold: 0.5 });
      bObs.observe(banner);
    }

    // Service cards
    var cardObs = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting) {
          var h3 = entry.target.querySelector('h3');
          var label = h3 ? h3.textContent.trim() : 'unknown';
          if (session.service_cards_viewed.indexOf(label) === -1)
            session.service_cards_viewed.push(label);
        }
      });
    }, { threshold: 0.6 });
    document.querySelectorAll('#services .card').forEach(function(c){ cardObs.observe(c); });
  }

  // ─── Pricing Card Hover & Dwell ───────────────────────────────
  document.querySelectorAll('.price-card').forEach(function(card){
    var label = (card.querySelector('h3') || {}).textContent || 'unknown';
    label = label.trim();
    var enterMs = null;

    function onEnter() { enterMs = Date.now(); }
    function onLeave() {
      if (!enterMs) return;
      var dwell = Date.now() - enterMs;
      if (!session.pricing_cards_hovered[label])
        session.pricing_cards_hovered[label] = { hovers: 0, total_dwell_ms: 0 };
      session.pricing_cards_hovered[label].hovers++;
      session.pricing_cards_hovered[label].total_dwell_ms += dwell;
      enterMs = null;
    }

    card.addEventListener('mouseenter', onEnter);
    card.addEventListener('mouseleave', onLeave);
    card.addEventListener('touchstart', onEnter, { passive: true });
    card.addEventListener('touchend', onLeave, { passive: true });
  });

  // ─── CTA Clicks ───────────────────────────────────────────────
  function getScrollPct() {
    var st = window.scrollY || document.documentElement.scrollTop;
    var dh = document.documentElement.scrollHeight - window.innerHeight;
    return dh > 0 ? Math.round((st / dh) * 100) : 0;
  }

  document.querySelectorAll('[data-track]').forEach(function(el){
    el.addEventListener('click', function(){
      var label = el.dataset.track;
      session.cta_clicks.push({
        label:    label,
        href:     el.getAttribute('href') || '',
        ts:       new Date().toISOString(),
        scroll:   getScrollPct(),
        section:  session.exit_section,
      });
      if (label === 'whatsapp') session.whatsapp_clicks++;
      if (label === 'callback') session.callback_form_clicks++;
      if (label === 'email')    session.email_clicks++;
    });
  });

  // ─── Exit Intent ──────────────────────────────────────────────
  document.addEventListener('mouseleave', function(e){
    if (e.clientY <= 0 && !session.exit_intent_fired) {
      session.exit_intent_fired    = true;
      session.exit_intent_scroll_pct = getScrollPct();
    }
  });

  // ─── Rage Clicks ─────────────────────────────────────────────
  var clickBuf = [];
  document.addEventListener('click', function(e){
    var now = Date.now(), x = e.clientX, y = e.clientY;
    var tgt = e.target.tagName + (e.target.id ? '#'+e.target.id : '');
    clickBuf = clickBuf.filter(function(c){
      return now - c.t < 2000 && Math.abs(c.x-x) < 40 && Math.abs(c.y-y) < 40;
    });
    clickBuf.push({ t: now, x: x, y: y });
    if (clickBuf.length >= 3) {
      session.rage_clicks.push({ target: tgt, x: Math.round(x), y: Math.round(y), count: clickBuf.length, ts: new Date().toISOString() });
      clickBuf = [];
    }
  });

  // ─── Copy Events ─────────────────────────────────────────────
  document.addEventListener('copy', function(){
    session.copy_events++;
    var sel = (window.getSelection() || '').toString().toLowerCase();
    if (sel.indexOf('9217034234') !== -1)      session.phone_number_copied = true;
    if (sel.indexOf('contact@stenosathi') !== -1) session.email_address_copied = true;
  });

  // ─── Flush to Supabase ────────────────────────────────────────
  var flushed = false;
  function flush() {
    if (flushed) return;
    flushed = true;

    // Finalise session
    session.session_duration_sec = Math.round(performance.now() / 1000);
    var d = session.session_duration_sec;
    session.duration_bucket = d < 30 ? '<30s' : d < 60 ? '30-60s' : d < 180 ? '1-3m' : d < 300 ? '3-5m' : '5m+';

    if (currentSection && sectionEnterTime) {
      var spent = Math.round((Date.now() - sectionEnterTime) / 1000);
      session.time_per_section[currentSection] = (session.time_per_section[currentSection] || 0) + spent;
    }

    // Save locally as fallback
    var sessions = getOrCreate(STORAGE_KEY, []);
    sessions.push(session);
    if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(sessions.length - MAX_SESSIONS);
    save(STORAGE_KEY, sessions);
    updateAggregate(session);

    // Send to Supabase
    var payload = JSON.stringify([{
      session_id:             session.session_id,
      visitor_id:             session.visitor_id,
      is_returning:           session.is_returning,
      date_ist:               session.date_ist,
      hour_ist:               session.hour_ist,
      day_of_week:            session.day_of_week,
      referrer:               session.referrer,
      utm:                    session.utm,
      device:                 session.device,
      os:                     session.os,
      browser:                session.browser,
      screen_res:             session.screen_res,
      viewport:               session.viewport,
      language:               session.language,
      connection_type:        session.connection_type,
      page_load_ms:           session.page_load_ms,
      session_duration_sec:   session.session_duration_sec,
      duration_bucket:        session.duration_bucket,
      max_scroll_depth:       session.max_scroll_depth,
      scroll_milestones:      session.scroll_milestones,
      sections_viewed:        session.sections_viewed,
      time_per_section:       session.time_per_section,
      pricing_cards_hovered:  session.pricing_cards_hovered,
      service_cards_viewed:   session.service_cards_viewed,
      testimonial_viewed:      session.testimonial_viewed,
      countdown_timer_seen:    session.countdown_timer_seen,
      cta_clicks:             session.cta_clicks,
      whatsapp_clicks:        session.whatsapp_clicks,
      callback_form_clicks:   session.callback_form_clicks,
      email_clicks:           session.email_clicks,
      exit_intent_fired:      session.exit_intent_fired,
      exit_intent_scroll_pct: session.exit_intent_scroll_pct,
      exit_section:           session.exit_section,
      rage_clicks:            session.rage_clicks,
      copy_events:            session.copy_events,
      phone_number_copied:    session.phone_number_copied,
      email_address_copied:   session.email_address_copied,
    }]);

    // Use sendBeacon for reliability on page unload
    var url = SUPABASE_URL + '/rest/v1/' + TABLE;
    var blob = new Blob([payload], { type: 'application/json' });

    // Try sendBeacon first (works during page unload)
    if (navigator.sendBeacon) {
      // sendBeacon doesn't support custom headers, so use fetch with keepalive as primary
    }

    // fetch with keepalive — works on page unload in modern browsers
    try {
      fetch(url, {
        method:  'POST',
        keepalive: true,
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer':        'return=minimal',
        },
        body: payload,
      }).catch(function(){});
    } catch(e) {}
  }

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  // ─── Local Aggregate (fallback) ───────────────────────────────
  function updateAggregate(s) {
    var agg = getOrCreate(AGGREGATE_KEY, {
      totalSessions: 0, newVisitors: 0, returningVisitors: 0,
      peakHours: {}, peakDays: {},
      deviceBreakdown: { mobile:0, tablet:0, desktop:0 },
      totalWhatsappClicks: 0, totalCallbackClicks: 0, totalEmailClicks: 0,
    });
    agg.totalSessions++;
    if (s.is_returning) agg.returningVisitors++; else agg.newVisitors++;
    agg.peakHours[s.hour_ist] = (agg.peakHours[s.hour_ist] || 0) + 1;
    agg.peakDays[s.day_of_week] = (agg.peakDays[s.day_of_week] || 0) + 1;
    if (agg.deviceBreakdown[s.device] !== undefined) agg.deviceBreakdown[s.device]++;
    agg.totalWhatsappClicks += s.whatsapp_clicks || 0;
    agg.totalCallbackClicks += s.callback_form_clicks || 0;
    agg.totalEmailClicks    += s.email_clicks || 0;
    save(AGGREGATE_KEY, agg);
  }

  // ─── Public API ───────────────────────────────────────────────
  window.StenoAnalytics = {
    track: function(cat, action, label) {
      if (!session.custom_events) session.custom_events = [];
      session.custom_events.push({ category: cat, action: action, label: label||'', ts: new Date().toISOString() });
    },
    getSession:   function() { return session; },
    getAggregate: function() { return getOrCreate(AGGREGATE_KEY, {}); },
    flush:        flush,
  };

  console.log('%c[StenoAnalytics] %cv2.0 — Supabase connected', 'color:#00a86b;font-weight:bold', 'color:#556471');

})();
