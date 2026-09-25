import { apiRaw, ApiError } from '@/services/api';

/** Uploads a picture for website articles or announcements (owner portal). Returns its public address. */
export async function uploadOwnerImage(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new ApiError(413, 'FILE_TOO_LARGE', 'Images must be 5 MB or smaller');
  const form = new FormData();
  form.append('file', file);
  const res = await apiRaw('/owner/blog/images', { form, realm: 'owner' });
  return ((await res.json()) as { data: { id: string; url: string } }).data;
}
