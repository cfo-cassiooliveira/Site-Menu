import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (file) => readFileSync(join(root, file), 'utf-8');

const indexHtml = read('index.html');
const page = new DOMParser().parseFromString(indexHtml, 'text/html');
const tokensCss = read('css/tokens.css');
const siteCss = read('css/site.css');

const meta = (selector) => page.querySelector(selector)?.getAttribute('content');
const contactCards = () => [...page.querySelectorAll('.contact-card')];

describe('responsiveness', () => {
  // Regressão: a página recarregava a cada resize (e no celular, ao esconder a barra de endereço durante a rolagem).
  it('page_DoesNotReloadOnResizeNorReadViewportOnlyOnLoad', () => {
    expect(indexHtml).not.toMatch(/location\.reload|innerWidth/);
  });

  // Regressão: a lista ficava num scroll interno de calc(100vh - 350px), que media 40px em paisagem (844x390).
  it('contactList_HasNoInnerScrollTiedToViewportHeight', () => {
    expect(siteCss).not.toMatch(/max-height:\s*calc\(100vh/);
    expect(siteCss).not.toMatch(/overflow-y:\s*auto/);
  });

  it('css_UsesDynamicViewportUnitsInsteadOf100vh', () => {
    expect(siteCss).not.toMatch(/\b100vh\b/);
  });

  it('css_IsMobileFirst', () => {
    expect(siteCss).not.toMatch(/@media[^{]*max-width/);
  });

  it('css_TurnsOffDecorativeAnimationWhenUserPrefersReducedMotion', () => {
    const reducedMotion = siteCss.slice(siteCss.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reducedMotion).toMatch(/body\s*{\s*animation: none;/);
    expect(reducedMotion).toMatch(/\.floating-elements\s*{\s*display: none;/);
  });

  it('hoverEffects_OnlyApplyToDevicesThatCanHover', () => {
    const outsideHoverQuery = siteCss.replace(/@media \(hover: hover\)\s*{[\s\S]*?\n}/, '');

    expect(outsideHoverQuery).not.toContain(':hover');
  });
});

describe('accessibility', () => {
  it('page_HasSingleH1AndLandmarks', () => {
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelectorAll('main')).toHaveLength(1);
    expect(page.querySelector('main nav[aria-label]')).not.toBeNull();
  });

  it('contactCards_HaveVisibleTextAndDecorativeIcons', () => {
    for (const card of contactCards()) {
      expect(card.querySelector('.contact-card__text').textContent.trim()).not.toBe('');
      expect(card.querySelector('.contact-card__icon').getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('contactCards_HaveVisibleFocusStyle', () => {
    expect(siteCss).toMatch(/\.contact-card:focus-visible\s*{\s*outline: 3px solid/);
  });

  it('externalLinks_OpenedInNewTabUseNoopener', () => {
    for (const link of page.querySelectorAll('a[target="_blank"]')) {
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });
});

describe('color contrast (WCAG 1.4.3)', () => {
  // Aceita #rgb e #rrggbb (o Stylelint exige a forma curta quando possível).
  const rgb = (hex) => {
    const digits = hex.length === 4 ? [...hex.slice(1)].map((d) => d + d).join('') : hex.slice(1);
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  };
  const luminance = (color) => {
    const [r, g, b] = color.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const hex = '(#[0-9a-f]{6}|#[0-9a-f]{3})\\b';
  const white = rgb(tokensCss.match(new RegExp(`--color-ink:\\s*${hex}`, 'i'))[1]);
  const brands = [...tokensCss.matchAll(new RegExp(`--brand-([a-z]+):\\s*linear-gradient\\(135deg, ${hex}, ${hex}\\)`, 'gi'))];

  it('everyContactCard_HasBrandColor', () => {
    expect(brands.map(([, name]) => name).sort()).toEqual(
      contactCards().map((card) => card.className.match(/contact-card--([a-z]+)/)[1]).sort(),
    );
  });

  // Regressão: no hover, o texto branco ficava ilegível em 6 das 9 redes (WhatsApp: 1,98:1).
  it.each(brands.map(([, name, start, end]) => [name, start, end]))(
    '%s_HoverBackground_KeepsWhiteTextAboveAA',
    (_name, start, end) => {
      expect(ratio(white, rgb(start))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(white, rgb(end))).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('privacy and security', () => {
  // Regressão (LGPD): o Google Tag Manager gravava cookies de analytics sem consentimento.
  it('page_DoesNotLoadThirdPartyTrackersNorScripts', () => {
    expect(indexHtml).not.toMatch(/googletagmanager|google-analytics|GTM-|gtag\(|jquery/i);
    expect([...page.querySelectorAll('script')].every((s) => s.type === 'application/ld+json')).toBe(true);
  });

  it('contentSecurityPolicy_IsDeclaredAndBlocksScripts', () => {
    const csp = meta('meta[http-equiv="Content-Security-Policy"]') ?? '';

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });

  it('externalStylesheets_HaveSubresourceIntegrity', () => {
    const external = [...page.querySelectorAll('link[rel="stylesheet"]')].filter((l) => l.getAttribute('href').startsWith('https://'));

    expect(external.length).toBeGreaterThan(0);
    for (const link of external) {
      expect(link.getAttribute('integrity')).toMatch(/^sha384-/);
      expect(link.getAttribute('crossorigin')).toBe('anonymous');
    }
  });
});

describe('seo', () => {
  it('title_FitsInGoogleResults', () => {
    expect(page.title.length).toBeLessThanOrEqual(60);
  });

  it('description_FitsInGoogleResults', () => {
    const description = meta('meta[name="description"]');

    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it('canonical_PointsToProductionDomain', () => {
    expect(page.querySelector('link[rel="canonical"]').getAttribute('href')).toBe('https://info.cassiofernandooliveira.com.br/');
  });

  it('structuredData_MatchesProfilesLinkedOnPage', () => {
    const person = JSON.parse(page.querySelector('script[type="application/ld+json"]').textContent);
    const profileLinks = contactCards()
      .map((card) => card.getAttribute('href'))
      .filter((href) => href.startsWith('https://') && !href.includes('whatsapp'));

    expect(person['@type']).toBe('Person');
    expect([...person.sameAs].sort()).toEqual(profileLinks.sort());
  });

  it('robots_AllowsCrawlersToRenderCssAndPointsToSitemap', () => {
    const robots = read('robots.txt');

    expect(robots).not.toMatch(/Disallow:\s*\/\*\.(css|js)/);
    expect(robots).toContain('Sitemap: https://info.cassiofernandooliveira.com.br/sitemap.xml');
  });
});
