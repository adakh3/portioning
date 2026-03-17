from rest_framework.pagination import PageNumberPagination


class OptionalPagination(PageNumberPagination):
    """Default pagination with opt-out via ?page_size=all."""
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 500

    def get_page_size(self, request):
        if request.query_params.get(self.page_size_query_param) == 'all':
            return None
        return super().get_page_size(request)

    def paginate_queryset(self, queryset, request, view=None):
        if self.get_page_size(request) is None:
            return None
        return super().paginate_queryset(queryset, request, view)
