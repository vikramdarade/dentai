/**
 * Utility to gate features to Vercel Preview deployments and local testing,
 * ensuring production environments remain completely unperturbed.
 */

export function isPmsPreviewEnabled(): boolean {
  if (typeof window === 'undefined') {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  }

  // Explicit URL query parameter override: ?pmsPreview=true or ?pmsPreview=false
  const params = new URLSearchParams(window.location.search);
  if (params.get('pmsPreview') === 'true' || params.get('preview') === 'true') {
    try {
      localStorage.setItem('dentai_pms_preview', 'true');
    } catch {
      // ignore
    }
    return true;
  }
  if (params.get('pmsPreview') === 'false') {
    try {
      localStorage.removeItem('dentai_pms_preview');
    } catch {
      // ignore
    }
    return false;
  }

  // Local storage sticky override
  try {
    if (localStorage.getItem('dentai_pms_preview') === 'true') {
      return true;
    }
  } catch {
    // ignore
  }

  const hostname = window.location.hostname;

  // Active in localhost/development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return true;
  }

  // Active on Vercel Preview Deployments (e.g., dentai-git-feature-*.vercel.app)
  if (hostname.includes('.vercel.app')) {
    return true;
  }

  return false;
}
