import { type EmailOtpType } from '@supabase/supabase-js'
import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get('code')
	const token_hash = url.searchParams.get('token_hash') as string
	const type = url.searchParams.get('type') as EmailOtpType | null
	// Only allow same-origin paths ("/foo"), never "//host" or absolute URLs,
	// so the link in the email can't be turned into an open redirect.
	const rawNext = url.searchParams.get('next') ?? '/'
	const next = /^\/(?![/\\])/.test(rawNext) ? rawNext : '/'

	const redirectTo = new URL(url)
	redirectTo.pathname = next
	redirectTo.searchParams.delete('code')
	redirectTo.searchParams.delete('token_hash')
	redirectTo.searchParams.delete('type')
	redirectTo.searchParams.delete('next')

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code)
		if (!error) {
			redirect(303, redirectTo)
		}
	}

	if (token_hash && type) {
		const { error } = await supabase.auth.verifyOtp({ token_hash, type })
		if (!error) {
			redirect(303, redirectTo)
		}
	}

	redirectTo.pathname = '/auth/error'
	redirect(303, redirectTo)
}
