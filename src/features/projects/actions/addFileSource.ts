'use server';

import { db } from '@/libs/db/db';
import { sources } from '@/libs/db/schemas/sources';
import { createClient } from '@/libs/supabase/server';
import { createAdminClient } from '@/libs/supabase/admin';
import { uploadFile } from '@/libs/supabase/files';
import { publishProcessJob } from '@/libs/qstash/jobs';
import { revalidatePath } from 'next/cache';
import { checkAndSpendTokens, TOKEN_COSTS } from '@/libs/db/tokens';
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB } from '@/libs/fileUpload';

export async function addFileSource(projectId: string, file: File, name?: string): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const supabaseAdminClientServer = await createAdminClient();

  if (!user) throw new Error('Unauthorized');

  if (file.size > MAX_FILE_SIZE) throw new Error(`File size exceeds the ${MAX_FILE_SIZE_MB} MB limit`);

  const tokenResult = await checkAndSpendTokens(user.id, TOKEN_COSTS.file, `File processing: ${name || file.name}`);
  if (!tokenResult.success) return { error: tokenResult.error };

  const sanitizedFileName = file.name.replace(/\s/g, '-');
  const storagePath = `${user.id}/${projectId}/${Date.now()}-${sanitizedFileName}`;
  await uploadFile(supabaseAdminClientServer, storagePath, file);

  const [source] = await db
    .insert(sources)
    .values({
      projectId,
      userId: user.id,
      type: 'file',
      name: name?.trim() || file.name,
      storagePath,
      status: 'pending',
    })
    .returning({ id: sources.id });

  await publishProcessJob(source.id);

  revalidatePath(`/projects/${projectId}`);
}
