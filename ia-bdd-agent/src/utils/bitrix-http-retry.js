function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableBitrixError(err) {
  if (!err) return false;
  const status = err.response && err.response.status;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = String(err.message || err.code || '');
  return /ECONNRESET|ETIMEDOUT|socket hang up|503|429|502|504/i.test(msg);
}

function isRetryableHttpStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Executa chamada REST ao Bitrix com backoff em 429/503 e erros transitórios.
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number }} [options]
 * @returns {Promise<T>}
 */
async function withBitrixRetry(label, fn, options = {}) {
  const maxAttempts = Math.max(
    1,
    Number.parseInt(
      process.env.BITRIX_HTTP_RETRY_MAX || String(options.maxAttempts || 4),
      10
    ) || 4
  );
  const baseMs = Math.max(
    200,
    Number.parseInt(process.env.BITRIX_HTTP_RETRY_BASE_MS || '600', 10) || 600
  );

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableBitrixError(err) || attempt >= maxAttempts) {
        throw err;
      }
      const wait = baseMs * attempt;
      console.warn(
        `[Bitrix] ${label}: ${err.message || err} — nova tentativa em ${wait}ms (${attempt}/${maxAttempts})`
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

module.exports = {
  sleep,
  withBitrixRetry,
  isRetryableBitrixError,
  isRetryableHttpStatus,
};
