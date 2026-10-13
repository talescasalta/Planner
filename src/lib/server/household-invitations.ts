import { supabaseAdmin } from '$lib/server/supabase';

// Joining a group takes the invitee's consent: an admin records an invitation
// and the membership only exists once the invited person accepts it. Without
// that step anyone could pull a freshly signed-up account into their own group
// before it created one, and that group would then receive everything the
// person imports (see getUserHouseholdId).
//
// household_invitations has RLS with no policy, so every read and write goes
// through the service role. Callers check the session (and, for creating or
// cancelling, the admin role) before calling in; each statement here is still
// scoped by the invitee or the household it was authorized for.

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
	userId: string
): Promise<ReceivedInvitation[]> {
	const { data, error } = await supabaseAdmin
		.from('household_invitations')
		.select('id, invited_by_user_id, created_at, households ( name )')
		.eq('user_id', userId)
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
	userId: string;
	email: string;
	invitedByUserId: string;
}): Promise<'created' | 'duplicate' | 'error'> {
	const { error } = await supabaseAdmin.from('household_invitations').insert({
		household_id: invitation.householdId,
		user_id: invitation.userId,
		email: invitation.email,
		invited_by_user_id: invitation.invitedByUserId
	});
	if (!error) return 'created';
	if (error.code === UNIQUE_VIOLATION) return 'duplicate';
	console.error('[household-invitations] create', error);
	return 'error';
}

// Turns the invitee's own invitation into a membership. The lookup is scoped
// by the invitee, so an invitation id addressed to someone else is not found.
export async function acceptInvitation(
	invitationId: string,
	userId: string
): Promise<'accepted' | 'not_found' | 'error'> {
	const { data: invitation, error } = await supabaseAdmin
		.from('household_invitations')
		.select('id, household_id')
		.eq('id', invitationId)
		.eq('user_id', userId)
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
			user_id: userId,
			role: 'member'
		});
	// Already a member (accepted twice, or added before invitations existed):
	// the invitation is simply spent.
	if (memberError && memberError.code !== UNIQUE_VIOLATION) {
		console.error('[household-invitations] accept insert', memberError);
		return 'error';
	}

	await deleteInvitation({ id: invitation.id, userId });
	return 'accepted';
}

// Declining is scoped by the invitee; cancelling by the household its admin
// was checked against.
export async function deleteInvitation(
	scope: { id: string } & ({ userId: string } | { householdId: string })
): Promise<boolean> {
	let query = supabaseAdmin
		.from('household_invitations')
		.delete()
		.eq('id', scope.id);
	query =
		'userId' in scope
			? query.eq('user_id', scope.userId)
			: query.eq('household_id', scope.householdId);
	const { error } = await query;
	if (error) console.error('[household-invitations] delete', error);
	return !error;
}
