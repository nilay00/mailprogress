
import { ref } from 'vue';
const API_URL = import.meta.env.VITE_API_URL || "";

export default
{
	name : 'SendMail',

	setup()
	{
		let model = ref({
			to : '',
			subject : 'Testing for Dynamic progress bar',
			durationMinutes : 1
		});

		let sending = ref(false);
		let error   = ref('');

		return {
			model,
			sending,
			error,
			sendEmail
		};

		async function sendEmail()
		{
			sending.value = true;

			try
			{
				fetch(`${API_URL}/api/send-email`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify(model.value)
				});
			}
			catch (err)
			{
				error.value = err.message || 'Unable to send email.';
			}
			finally
			{
				sending.value = false;
			}
		}
	}
};