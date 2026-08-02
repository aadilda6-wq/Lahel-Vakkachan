const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong and response latency statistics'),

  async execute(interaction) {
    // Fetch the response object to calculate roundtrip latency
    const sent = await interaction.reply({ 
      content: '⚡ Pinging gateway...', 
      fetchReply: true, 
      ephemeral: true 
    });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiPing = Math.round(interaction.client.ws.ping);

    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setColor('#00ffcc')
      .addFields(
        { name: 'Roundtrip Latency', value: `\`${latency}ms\``, inline: true },
        { name: 'WebSocket API Latency', value: `\`${apiPing}ms\``, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ content: '', embeds: [embed] });
  },
};
