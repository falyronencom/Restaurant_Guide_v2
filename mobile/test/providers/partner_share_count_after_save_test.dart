import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';

import '../support/wire_stand.dart';

/// Число «Поделились» приходит только со списком заведений (`share_count`), а
/// ответ на правку карточки его не несёт. Провайдер кладёт этот ответ на место
/// строки списка, и без сохранения числа партнёр после любой правки видел бы на
/// карточке 0, пока список не обновится.
void main() {
  const id = '44444444-4444-4444-8444-444444444444';

  Map<String, dynamic> row(String name, {int? shares}) => {
        'id': id,
        'name': name,
        'status': 'active',
        'view_count': 9,
        'favorite_count': 1,
        if (shares != null) 'share_count': shares,
      };

  test('правка карточки не обнуляет «Поделились»', () async {
    installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/partner/establishments' && options.method == 'GET') {
        return jsonBody({
          'success': true,
          'data': {
            'establishments': [row('Васильки', shares: 7)],
          },
        });
      }
      if (path == '/api/v1/partner/establishments/$id' &&
          options.method == 'PUT') {
        return jsonBody({
          'success': true,
          'data': {'establishment': row('Васильки на Немиге')},
        });
      }
      return jsonBody({'success': false}, status: 404);
    });

    final provider = PartnerDashboardProvider();
    await provider.loadEstablishments();
    expect(provider.establishments.single.stats.shares, 7,
        reason: 'предпосылка: число пришло со списком');

    final saved = await provider.updateEstablishment(
      id,
      {'name': 'Васильки на Немиге'},
      failureMessage: 'Не удалось сохранить',
    );

    expect(saved, isTrue);
    final card = provider.establishments.single;
    expect(card.name, 'Васильки на Немиге', reason: 'правка легла на строку');
    expect(card.stats.shares, 7);
    expect(card.stats.views, 9);
  });
}
