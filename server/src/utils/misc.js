const slugify = (text) =>
  String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'item';

/** Parse ?page & ?pageSize into a Sequelize limit/offset. */
const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '25', 10) || 25));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
};

const meta = (count, { page, pageSize }) => ({
  total: count,
  page,
  pageSize,
  totalPages: Math.max(1, Math.ceil(count / pageSize))
});

module.exports = { slugify, paginate, meta };
