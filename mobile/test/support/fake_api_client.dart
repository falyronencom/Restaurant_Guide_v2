import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Scripted transport for provider/screen tests.
///
/// Only `get` and `put` are exercised by the preferences provider; the rest of
/// the ApiClient surface is unreachable here and falls through to
/// [noSuchMethod]. No mocking framework — `implements` by hand, as elsewhere
/// in the project's tests.
class FakeApiClient implements ApiClient {
  /// Body of `data` in the GET envelope.
  Map<String, dynamic> prefsFromServer = const {};
  Object? getError;
  Object? putError;
  int getCalls = 0;
  final List<Map<String, dynamic>> putBodies = [];

  @override
  Future<Response> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    getCalls++;
    if (getError != null) throw getError!;
    return Response(
      requestOptions: RequestOptions(path: path),
      statusCode: 200,
      data: <String, dynamic>{'success': true, 'data': prefsFromServer},
    );
  }

  @override
  Future<Response> put(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    putBodies.add(Map<String, dynamic>.from(data as Map));
    if (putError != null) throw putError!;
    return Response(
      requestOptions: RequestOptions(path: path),
      statusCode: 200,
      data: <String, dynamic>{'success': true},
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
