const Team = require('../models/team');
const logger = require('../utils/logger');

/**
 * Checks member roles against guild configurations to determine authorization levels.
 * Falls back to Discord Administrator flag or Server Owner as Admin level.
 * @param {GuildMember} member Discord guild member object
 * @returns {Promise<{isAdmin: boolean, isLeader: boolean, isMember: boolean}>} Authorization flags
 */
async function getMemberPermissions(member) {
  const permissions = {
    isAdmin: false,
    isLeader: false,
    isMember: false
  };

  if (!member || !member.guild) {
    return permissions;
  }

  // Server Owner or Discord Administrator always gets full privileges
  if (member.id === member.guild.ownerId || member.permissions.has('Administrator')) {
    permissions.isAdmin = true;
    permissions.isLeader = true;
    permissions.isMember = true;
    return permissions;
  }

  try {
    const settings = await Team.findOne({ guildId: member.guild.id });
    if (!settings) {
      // If no configurations exist, only Discord Administrators have access
      return permissions;
    }

    const memberRoleIds = member.roles.cache.map(role => role.id);

    // 1. Admin Role check
    const hasAdminRole = settings.adminRoles.some(id => memberRoleIds.includes(id));
    if (hasAdminRole) {
      permissions.isAdmin = true;
      permissions.isLeader = true;
      permissions.isMember = true;
      return permissions;
    }

    // 2. Leader Role check
    const hasLeaderRole = settings.leaderRoles.some(id => memberRoleIds.includes(id));
    if (hasLeaderRole) {
      permissions.isLeader = true;
      permissions.isMember = true;
      return permissions;
    }

    // 3. Member Role check
    const hasMemberRole = settings.memberRoles.some(id => memberRoleIds.includes(id));
    if (hasMemberRole) {
      permissions.isMember = true;
      return permissions;
    }

    // Check if the user is a leader in any custom teams
    const isCustomTeamLead = settings.teams.some(team => team.leaderId === member.id);
    if (isCustomTeamLead) {
      permissions.isLeader = true;
      permissions.isMember = true;
      return permissions;
    }

    // Check if the user is a member of any custom teams
    const isCustomTeamMember = settings.teams.some(team => team.members.includes(member.id));
    if (isCustomTeamMember) {
      permissions.isMember = true;
    }

  } catch (error) {
    logger.error(`Error resolving permissions for user ${member.id}:`, error);
  }

  return permissions;
}

module.exports = {
  getMemberPermissions
};
