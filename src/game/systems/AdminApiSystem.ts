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

  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };

  if (!response.ok) {
    throw new Error(payload.message ?? `Request failed: ${response.status}`);
  }

  return payload;
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
