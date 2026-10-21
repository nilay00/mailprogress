
import { ref } from 'vue';

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
				await fetch('/api/send-email',
				{
					method : 'POST',
					headers : {
						'Content-Type' : 'application/json'
					},
					body : JSON.stringify(model.value)
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