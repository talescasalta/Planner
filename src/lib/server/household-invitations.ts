import { supabaseAdmin } from '$lib/server/supabase';

// Joining a group takes the invitee's consent: an admin records an invitation
// and the membership only exists once the invited person accepts it. Without
// that step anyone could pull a freshly signed-up account into their own group
// before it created one, and that group would then receive everything the
// person imports (see getUserHouseholdId).
//
// An invitation is addressed to an e-mail, never resolved to an account when
// it is sent: the answer to "Convidar membro" is the same whether or not that
// e-mail has an account, so it cannot be used to find out who is registered.
// The invitee is whoever signs in with that e-mail (lowercased on both sides).
//
// household_invitations has RLS with no policy, so every read and write goes
// through the service role. Callers check the session (and, for creating or
// cancelling, the admin role) before calling in; each statement here is still
// scoped by the invitee's e-mail or the household it was authorized for.

export function normalizeInviteEmail(email: string | null | undefined) {
	return (email ?? '').trim().toLowerCase();
}

// Enough to refuse typos and pasted junk; delivery is never attempted.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isInviteEmail(email: string): boolean {
	return email.length <= 254 && EMAIL.test(email);
}

export type ReceivedInvitation = {
	id: string;
	household_name: string;
	invited_by_name: string | null;
};

export type SentInvitation = { id: string; email: string };

const UNIQUE_VIOLATION = '23505';

type HouseholdJoin = { name: string } | { name: string }[] | null;

function householdName(joined: HouseholdJoin): string {
	const household = Array.isArray(joined) ? joined[0] : joined;
	return household?.name ?? 'Grupo';
}

export async function loadReceivedInvitations(
	userEmail: string | null | undefined
): Promise<ReceivedInvitation[]> {
	const email = normalizeInviteEmail(userEmail);
	if (!email) return [];
	const { data, error } = await supabaseAdmin
		.from('household_invitations')
		.select('id, invited_by_user_id, created_at, households ( name )')
		.eq('email', email)
		.order('created_at', { ascending: true });
	if (error) {
		console.error('[household-invitations] received', error);
		return [];
	}
	const rows = (data ?? []) as Array<{
		id: string;
		invited_by_user_id: string | null;
		households: HouseholdJoin;
	}>;
	const inviterIds = Array.from(
		new Set(
			rows
				.map((row) => row.invited_by_user_id)
				.filter((id): id is string => !!id)
		)
	);
	const { data: profiles } =
		inviterIds.length > 0
			? await supabaseAdmin
					.from('profiles')
					.select('user_id, display_name')
					.in('user_id', inviterIds)
			: { data: [] };
	const names = new Map(
		(profiles ?? []).map(
			(profile: { user_id: string; display_name: string | null }) => [
				profile.user_id,
				profile.display_name
			]
		)
	);
	return rows.map((row) => ({
		id: row.id,
		household_name: householdName(row.households),
		invited_by_name: row.invited_by_user_id
			? (names.get(row.invited_by_user_id) ?? null)
			: null
	}));
}

export async function loadSentInvitations(
	householdId: string
): Promise<SentInvitation[]> {
	const { data, error } = await supabaseAdmin
		.from('household_invitations')
		.select('id, email')
		.eq('household_id', householdId)
		.order('created_at', { ascending: true });
	if (error) {
		console.error('[household-invitations] sent', error);
		return [];
	}
	return (data ?? []) as SentInvitation[];
}

export async function createInvitation(invitation: {
	householdId: string;
	email: string;
	invitedByUserId: string;
}): Promise<'created' | 'duplicate' | 'error'> {
	const { error } = await supabaseAdmin.from('household_invitations').insert({
		household_id: invitation.householdId,
		email: normalizeInviteEmail(invitation.email),
		invited_by_user_id: invitation.invitedByUserId
	});
	if (!error) return 'created';
	if (error.code === UNIQUE_VIOLATION) return 'duplicate';
	console.error('[household-invitations] create', error);
	return 'error';
}

// Turns the invitee's own invitation into a membership. The lookup is scoped
// by the invitee's e-mail, so an invitation id addressed to someone else is
// not found.
export async function acceptInvitation(
	invitationId: string,
	user: { id: string; email?: string | null }
): Promise<'accepted' | 'not_found' | 'error'> {
	const email = normalizeInviteEmail(user.email);
	if (!email) return 'not_found';
	const { data: invitation, error } = await supabaseAdmin
		.from('household_invitations')
		.select('id, household_id')
		.eq('id', invitationId)
		.eq('email', email)
		.maybeSingle();
	if (error) {
		console.error('[household-invitations] accept lookup', error);
		return 'error';
	}
	if (!invitation) return 'not_found';

	const { error: memberError } = await supabaseAdmin
		.from('household_members')
		.insert({
			household_id: invitation.household_id,
			user_id: user.id,
			role: 'member'
		});
	// Already a member (accepted twice, or added before invitations existed):
	// the invitation is simply spent.
	if (memberError && memberError.code !== UNIQUE_VIOLATION) {
		console.error('[household-invitations] accept insert', memberError);
		return 'error';
	}

	await deleteInvitation({ id: invitation.id, email });
	return 'accepted';
}

// Declining is scoped by the invitee; cancelling by the household its admin
// was checked against.
export async function deleteInvitation(
	scope: { id: string } & ({ email: string } | { householdId: string })
): Promise<boolean> {
	let query = supabaseAdmin
		.from('household_invitations')
		.delete()
		.eq('id', scope.id);
	query =
		'email' in scope
			? query.eq('email', normalizeInviteEmail(scope.email))
			: query.eq('household_id', scope.householdId);
	const { error } = await query;
	if (error) console.error('[household-invitations] delete', error);
	return !error;
}
