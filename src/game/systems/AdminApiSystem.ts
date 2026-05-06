import { normalizeEditorRows, validateEditorRows } from '../levels/editorGrid';
import type { AdminCampaignOverride } from '../levels/levelTypes';

interface AdminSessionResponse {
  authenticated: boolean;
}

interface AdminLoginResponse extends AdminSessionResponse {
  message?: string;
}

interface AdminCampaignOverridesResponse {
  overrides: AdminCampaignOverride[];
}

interface AdminCampaignDeleteResponse {
  removed: boolean;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  });

  const contentType = response.headers.get('content-type') ?? '';
  let payload: (T & { message?: string }) | undefined;

  if (contentType.includes('application/json')) {
    try {
      payload = (await response.json()) as T & { message?: string };
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    if (payload?.message) {
      throw new Error(payload.message);
    }

    if (!contentType.includes('application/json')) {
      const text = (await response.text().catch(() => '')).trim().slice(0, 200);
      throw new Error(
        text ? `Request failed (${response.status}): ${text}` : `Request failed: ${response.status}`
      );
    }

    throw new Error(`Request failed: ${response.status}`);
  }

  return (payload ?? ({} as T & { message?: string })) as T;
}

export class AdminApiSystem {
  public async login(password: string): Promise<AdminLoginResponse> {
    return requestJson<AdminLoginResponse>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
  }

  public async logout(): Promise<AdminSessionResponse> {
    return requestJson<AdminSessionResponse>('/api/admin/logout', {
      method: 'POST',
      body: '{}'
    });
  }

  public async getSession(): Promise<AdminSessionResponse> {
    return requestJson<AdminSessionResponse>('/api/admin/session');
  }

  public async getCampaignOverrides(): Promise<AdminCampaignOverride[]> {
    const data = await requestJson<AdminCampaignOverridesResponse>('/api/admin/campaign-levels');
    return data.overrides;
  }

  public async saveCampaignOverride(
    levelIndex: number,
    rows: readonly string[],
    name: string
  ): Promise<AdminCampaignOverride> {
    const normalizedRows = normalizeEditorRows(rows);
    const validation = validateEditorRows(normalizedRows);

    if (!validation.valid) {
      throw new Error(validation.message);
    }

    return requestJson<AdminCampaignOverride>(`/api/admin/campaign-levels/${levelIndex}`, {
      method: 'PUT',
      body: JSON.stringify({ name, rows: normalizedRows })
    });
  }

  public async deleteCampaignOverride(levelIndex: number): Promise<AdminCampaignDeleteResponse> {
    return requestJson<AdminCampaignDeleteResponse>(`/api/admin/campaign-levels/${levelIndex}`, {
      method: 'DELETE'
    });
  }
}
