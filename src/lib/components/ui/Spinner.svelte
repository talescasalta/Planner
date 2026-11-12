<script lang="ts">
	// Same ring the import confirmation used, drawn in the text color so it
	// works on primary, danger and neutral buttons alike.
	let { class: className = 'h-4 w-4' }: { class?: string } = $props();
</script>

<span
	class={`inline-block shrink-0 animate-spin rounded-full border-2 border-current/30 border-t-current ${className}`}
	aria-hidden="true"
></span>
